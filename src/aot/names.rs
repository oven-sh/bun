use crate::declared::{DeclaredTable, Part};
use crate::fragment::{Ids, Used, for_each_id_of_func, for_each_id_of_global, for_each_id_of_layout};
use crate::id::{FuncId, GlobalId, LayoutId, ModuleId, StrId, TyId, V};
use crate::ir::{Def, FuncKind, LayoutKind, Literal, Op, Prediction, Program, Strs, Why, field_flags, func_flags};
use bun_sema::atom::PRIVATE_NAME_PREFIX;
use bun_sema::util::{InParallel, for_each_mut};
use rustc_hash::FxHashMap;
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};

const FUNCTIONS_OF_A_SLICE: usize = 256;

pub(crate) const MARK_OF_DEAD_ZONE: u8 = 0xfc;
const MARK_OF_MEMBER: u8 = 1;

pub(crate) fn message_of_dead_zone(name: &[u8]) -> Vec<u8> {
    [b"Cannot access '", name, b"' before initialization."].concat()
}

fn text_numbered(mut number: usize) -> Vec<u8> {
    const FIRST: &[u8; 26] = b"abcdefghijklmnopqrstuvwxyz";
    const REST: &[u8; 62] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    let (mut length, mut count) = (1, FIRST.len() * REST.len());
    while number >= count {
        number -= count;
        length += 1;
        count *= REST.len();
    }
    let mut text = vec![FIRST[number % FIRST.len()]];
    number /= FIRST.len();
    for _ in 0..length {
        text.push(REST[number % REST.len()]);
        number /= REST.len();
    }
    text
}

#[derive(Default)]
struct Tokens {
    next: usize,
    said: Vec<(Vec<u8>, Vec<u8>)>,
}

impl Tokens {
    fn take(&mut self, strs: &Strs, original: &[u8]) -> Vec<u8> {
        loop {
            let text = text_numbered(self.next);
            self.next += 1;
            if text[1..].iter().any(u8::is_ascii_uppercase) && strs.find(&text).is_none() {
                self.said.push((text.clone(), original.to_vec()));
                return text;
            }
        }
    }
}

pub(crate) struct Said {
    tokens: Vec<(Vec<u8>, Vec<u8>)>,
    types: Vec<String>,
}

fn push_quoted(json: &mut String, text: &[u8]) {
    json.push('"');
    for character in String::from_utf8_lossy(text).chars() {
        match character {
            '"' | '\\' => json.extend(['\\', character]),
            '\0'..='\x1f' => json.push_str(&format!("\\u{:04x}", character as u32)),
            _ => json.push(character),
        }
    }
    json.push('"');
}

pub(crate) fn as_json(said: &Said) -> Vec<u8> {
    let mut json = String::from("{\n    \"positions\": \"original\",\n    \"tokens\": {");
    for (number, (short, original)) in said.tokens.iter().enumerate() {
        json.push_str(if number == 0 { "\n      " } else { ",\n      " });
        push_quoted(&mut json, short);
        json.push_str(": ");
        push_quoted(&mut json, original);
    }
    json.push_str("\n    },\n    \"types\": [");
    for (number, entry) in said.types.iter().enumerate() {
        json.push_str(if number == 0 { "\n      " } else { ",\n      " });
        json.push_str(entry);
    }
    json.push_str("\n    ]\n  }");
    json.into_bytes()
}

struct Strings<F: Fn(&mut StrId)>(F);

impl<F: Fn(&mut StrId)> Ids for Strings<F> {
    fn str(&mut self, id: &mut StrId) {
        (self.0)(id);
    }
    fn ty(&mut self, _: &mut TyId) {}
    fn layout(&mut self, _: &mut LayoutId) {}
    fn global(&mut self, _: &mut GlobalId) {}
    fn module(&mut self, _: &mut ModuleId) {}
    fn func(&mut self, _: &mut FuncId, _: Used) {}
}

fn for_each_string(program: &mut Program, changes_names: bool, in_parallel: InParallel<'_>, each: &(impl Fn(&mut StrId) + Sync)) {
    let Program {
        strs: _,
        tys,
        layouts,
        funcs,
        globals,
        modules,
        extended_globals,
        prototype_property_names,
        regexp_literals,
        logs_type_errors: _,
        marked_values: _,
        builtin_modules: _,
        builtin_functions: _,
        functions_by_key,
        accesses_of_one_row: _,
        parameters_as_written: _,
        may_be_handed_what_says_nothing: _,
        known_places: _,
        entries: _,
    } = program;
    let mut strings = Strings(|id: &mut StrId| each(id));
    let mut slices: Vec<&mut [crate::ir::Func]> = funcs.chunks_mut(FUNCTIONS_OF_A_SLICE).collect();
    for_each_mut(&mut slices, in_parallel, &|funcs| {
        for func in funcs.iter_mut() {
            for_each_id_of_func(func, &mut Strings(|id: &mut StrId| each(id)));
        }
    });
    for layout in layouts {
        for_each_id_of_layout(layout, &mut strings);
    }
    for global in globals {
        for_each_id_of_global(global, &mut strings);
    }
    let mut list = std::mem::take(&mut tys.list);
    for part in list.iter_mut().flat_map(|declared| &mut declared.parts) {
        if let Part::Global(name, _) = part {
            strings.str(name);
        }
    }
    if changes_names {
        let mut renumbered = DeclaredTable::default();
        for (number, declared) in list.into_iter().enumerate() {
            assert_eq!(renumbered.intern(declared).idx(), number);
        }
        *tys = renumbered;
    } else {
        tys.list = list;
    }
    for module in modules {
        for id in [&mut module.path, &mut module.display_path] {
            if id.is_some() {
                strings.str(id);
            }
        }
    }
    for name in extended_globals.iter_mut().chain(prototype_property_names) {
        strings.str(name);
    }
    for (pattern, flags) in regexp_literals {
        strings.str(pattern);
        strings.str(flags);
    }
    for (property, key, _) in functions_by_key {
        strings.str(property);
        strings.str(key);
    }
}

fn shorten_private_names(program: &mut Program, tokens: &mut Tokens, in_parallel: InParallel<'_>) {
    let mut short: FxHashMap<Vec<u8>, StrId> = FxHashMap::default();
    let mut whole: FxHashMap<StrId, StrId> = FxHashMap::default();
    for id in (0..program.strs.len()).map(StrId::new) {
        let text = program.strs.get(id);
        let Some(at) = bun_core::strings::index_of_char_usize(text, b'@').filter(|_| text.starts_with(PRIVATE_NAME_PREFIX)) else { continue };
        let (written, class) = (text[1..at].to_vec(), text[at..].to_vec());
        let token = match short.get(&written) {
            Some(&token) => token,
            None => {
                let text = [&b"#"[..], &tokens.take(&program.strs, &written[1..])].concat();
                let token = program.strs.intern(&text);
                short.insert(written, token);
                token
            }
        };
        let text = [&PRIVATE_NAME_PREFIX[..1], program.strs.get(token), &class].concat();
        whole.insert(id, program.strs.intern(&text));
    }
    if whole.is_empty() {
        return;
    }
    let Program { strs, layouts, funcs, .. } = program;
    for method in layouts.iter().flat_map(|layout| &layout.methods).filter(|method| method.func.is_some() && whole.contains_key(&method.name)) {
        let func = &mut funcs[method.func.idx()];
        if let Some(&token) = Some(func.name).filter(|name| name.is_some()).and_then(|name| short.get(strs.get(name))) {
            func.name = token;
        }
    }
    let (strs, new_private_name) = (&*strs, strs.find(b"NewPrivateName"));
    let mut slices: Vec<&mut [crate::ir::Func]> = funcs.chunks_mut(FUNCTIONS_OF_A_SLICE).collect();
    for_each_mut(&mut slices, in_parallel, &|funcs| {
        for func in funcs.iter_mut() {
            let texts: Vec<V> = (func.values.iter())
                .filter_map(|value| match &value.def {
                    Def::Op(Op::Operation { name, args }) if Some(*name) == new_private_name => args.first().copied(),
                    _ => None,
                })
                .collect();
            for text in texts {
                if let Def::Op(Op::Str(written)) = &mut func.values[text.idx()].def
                    && let Some(&token) = short.get(strs.get(*written))
                {
                    *written = token;
                }
            }
        }
    });
    for_each_string(program, true, in_parallel, &|id| {
        if let Some(&short) = whole.get(id) {
            *id = short;
        }
    });
}

pub(crate) fn shorten(program: &mut Program, in_parallel: InParallel<'_>) -> Said {
    const OF_RUNTIME: u16 = func_flags::IS_BUILTIN | func_flags::IS_OF_BUILTIN_MODULE;
    let messages: Vec<(StrId, StrId)> = (0..program.strs.len())
        .map(StrId::new)
        .filter(|&id| program.strs.get(id).first() == Some(&MARK_OF_DEAD_ZONE))
        .collect::<Vec<StrId>>()
        .into_iter()
        .map(|id| {
            let name = program.strs.get(id)[1..].to_vec();
            (id, program.strs.intern(&name))
        })
        .collect();

    let mut is_module_of_runtime = vec![false; program.modules.len()];
    for func in program.funcs.iter().filter(|func| func.flags & OF_RUNTIME != 0 && func.module.is_some()) {
        is_module_of_runtime[func.module.idx()] = true;
    }
    let mut is_path_of_runtime = vec![false; program.strs.len()];
    for (module, _) in program.modules.iter().zip(&is_module_of_runtime).filter(|(_, is_of_runtime)| **is_of_runtime) {
        for path in [module.path, module.display_path].into_iter().filter(|path| path.is_some()) {
            is_path_of_runtime[path.idx()] = true;
        }
    }
    let keeps_name = |func: &crate::ir::Func| func.flags & OF_RUNTIME != 0 || func.kind == FuncKind::Method || func.module.is_none();
    let is_layout_of_runtime: Vec<bool> = (program.layouts.iter())
        .map(|layout| {
            (layout.constructor.is_some() && program.funcs[layout.constructor.idx()].flags & OF_RUNTIME != 0) || (layout.declared_path.is_some() && (is_path_of_runtime[layout.declared_path.idx()] || program.strs.get(layout.declared_path).starts_with(bun_builtin_syntax::VIRTUAL_ROOT)))
        })
        .collect();

    let is_spelled: Vec<AtomicBool> = (0..program.strs.len()).map(|_| AtomicBool::new(false)).collect();
    let times_borne: Vec<AtomicU32> = (0..program.strs.len()).map(|_| AtomicU32::new(0)).collect();
    let mut is_member_nothing_stores = vec![false; program.strs.len()];
    let spell = |id: StrId| {
        if id.is_some() && !is_spelled[id.idx()].load(Ordering::Relaxed) {
            is_spelled[id.idx()].store(true, Ordering::Relaxed);
        }
    };
    let bear = |id: StrId| {
        if id.is_some() {
            times_borne[id.idx()].fetch_add(1, Ordering::Relaxed);
        }
    };
    let mut slices: Vec<&[crate::ir::Func]> = program.funcs.chunks(FUNCTIONS_OF_A_SLICE).collect();
    for_each_mut(&mut slices, in_parallel, &|funcs| {
      for func in funcs.iter() {
        if keeps_name(func) { spell(func.name) } else { bear(func.name) }
        for value in &func.values {
            if let Prediction::ByKey(property) = value.prediction {
                spell(property);
            }
            let Def::Op(op) = &value.def else { continue };
            match *op {
                Op::Str(text) | Op::BigInt(text) | Op::ExternalModule(text) => spell(text),
                Op::FreeGet { name, .. }
                | Op::FreeSet { name, .. }
                | Op::PropGet { name, .. }
                | Op::PropSet { name, .. }
                | Op::PropHas { name, .. }
                | Op::PropDelete { name, .. }
                | Op::CallMethod { name, .. }
                | Op::Operation { name, .. }
                | Op::NewWith { name, .. } => spell(name),
                Op::FieldGet { layout, field, .. } | Op::FieldSet { layout, field, .. } if program.layouts[layout.idx()].kind != LayoutKind::Environment => spell(program.layouts[layout.idx()].fields[field as usize].name),
                Op::Coerce { why: Why::NonNull(text), .. } => {
                    if func.flags & OF_RUNTIME != 0 { spell(text) } else { bear(text) }
                }
                _ => {}
            }
        }
      }
    });
    for (layout, &is_of_runtime) in program.layouts.iter().zip(&is_layout_of_runtime) {
        if is_of_runtime { spell(layout.name) } else { bear(layout.name) }
        for field in &layout.fields {
            if layout.kind == LayoutKind::Environment {
                bear(field.name);
            } else if is_of_runtime || field.flags & field_flags::NEVER_STORED == 0 || field.name.is_none() {
                spell(field.name);
            } else {
                is_member_nothing_stores[field.name.idx()] = true;
            }
            if is_of_runtime {
                spell(field.type_text);
            }
            for literal in &field.literals {
                if let Literal::Str(text) = *literal {
                    spell(text);
                }
            }
        }
        for method in &layout.methods {
            spell(method.name);
        }
        for field in &layout.static_fields {
            spell(field.0);
        }
    }
    for global in &program.globals {
        if global.module.is_some() && is_module_of_runtime[global.module.idx()] { spell(global.name) } else { bear(global.name) }
    }
    for part in program.tys.list.iter().flat_map(|declared| &declared.parts) {
        if let Part::Global(name, _) = *part {
            spell(name);
        }
    }
    for &name in program.extended_globals.iter().chain(&program.prototype_property_names) {
        spell(name);
    }
    for &(property, key, _) in &program.functions_by_key {
        spell(property);
        spell(key);
    }
    for &(_, name) in &messages {
        bear(name);
    }
    for (module, _) in program.modules.iter().zip(&is_module_of_runtime).filter(|(_, is_of_runtime)| !**is_of_runtime) {
        bear(module.path);
        bear(module.display_path);
    }
    for (path, _) in is_path_of_runtime.iter().enumerate().filter(|(_, is_of_runtime)| **is_of_runtime) {
        spell(StrId::new(path));
    }
    let is_spelled: Vec<bool> = is_spelled.into_iter().map(AtomicBool::into_inner).collect();
    let times_borne: Vec<u32> = times_borne.into_iter().map(AtomicU32::into_inner).collect();
    let is_path: Vec<bool> = {
        let mut is_path = vec![false; program.strs.len()];
        for path in program.modules.iter().flat_map(|module| [module.path, module.display_path]).filter(|path| path.is_some() && !is_path_of_runtime[path.idx()]) {
            is_path[path.idx()] = true;
        }
        is_path
    };

    let mut borne: Vec<StrId> = (0..program.strs.len()).map(StrId::new).filter(|id| times_borne[id.idx()] != 0 && (!is_spelled[id.idx()] || is_path[id.idx()]) && !program.strs.get(*id).is_empty() && !program.strs.get(*id).starts_with(PRIVATE_NAME_PREFIX)).collect();
    borne.sort_unstable_by(|&a, &b| times_borne[b.idx()].cmp(&times_borne[a.idx()]).then_with(|| program.strs.get(a).cmp(program.strs.get(b))));
    let mut short: FxHashMap<StrId, StrId> = FxHashMap::default();
    let mut tokens = Tokens::default();
    for original in borne {
        let text = tokens.take(&program.strs, &program.strs.get(original).to_vec());
        short.insert(original, program.strs.intern(&text));
    }
    let mut short_members: FxHashMap<StrId, StrId> = FxHashMap::default();
    let members: Vec<StrId> = (0..is_member_nothing_stores.len()).map(StrId::new).filter(|id| is_member_nothing_stores[id.idx()] && !is_spelled[id.idx()] && !program.strs.get(*id).starts_with(PRIVATE_NAME_PREFIX)).collect();
    for (number, &original) in members.iter().enumerate() {
        let text = [&[MARK_OF_MEMBER][..], &text_numbered(number)].concat();
        short_members.insert(original, program.strs.intern(&text));
    }
    let shortened = |id: StrId| short.get(&id).copied().unwrap_or(id);

    let final_messages: FxHashMap<StrId, StrId> = (messages.iter())
        .map(|&(message, name)| {
            let text = message_of_dead_zone(&program.strs.get(shortened(name)).to_vec());
            (message, program.strs.intern(&text))
        })
        .collect();
    let mut slices: Vec<&mut [crate::ir::Func]> = program.funcs.chunks_mut(FUNCTIONS_OF_A_SLICE).collect();
    for_each_mut(&mut slices, in_parallel, &|funcs| {
        for func in funcs.iter_mut() {
            let is_of_runtime = func.flags & OF_RUNTIME != 0;
            if !keeps_name(func) {
                func.name = shortened(func.name);
            }
            for value in &mut func.values {
                match &mut value.def {
                    Def::Op(Op::Str(text)) => {
                        if let Some(&message) = final_messages.get(text) {
                            *text = message;
                        }
                    }
                    Def::Op(Op::Coerce { why: Why::NonNull(text), .. }) if !is_of_runtime => *text = shortened(*text),
                    _ => {}
                }
            }
        }
    });
    let mut types: Vec<String> = Vec::new();
    for (layout, &is_of_runtime) in program.layouts.iter_mut().zip(&is_layout_of_runtime) {
        if is_of_runtime {
            continue;
        }
        layout.name = shortened(layout.name);
        if layout.declared_path.is_some() || layout.fields.iter().any(|field| field.type_text.is_some()) {
            let mut entry = String::from("{ \"name\": ");
            push_quoted(&mut entry, if layout.name.is_some() { program.strs.get(layout.name) } else { b"" });
            if layout.declared_path.is_some() {
                entry.push_str(", \"at\": ");
                push_quoted(&mut entry, &[program.strs.get(layout.declared_path), layout.declared_line.to_string().as_bytes()].join(&b':'));
            }
            entry.push_str(", \"members\": {");
            for (number, field) in layout.fields.iter().filter(|field| field.type_text.is_some() && field.name.is_some()).enumerate() {
                entry.push_str(if number == 0 { " " } else { ", " });
                push_quoted(&mut entry, program.strs.get(field.name));
                entry.push_str(": ");
                push_quoted(&mut entry, program.strs.get(field.type_text));
            }
            entry.push_str(" } }");
            types.push(entry);
        }
        layout.declared_path = StrId::NONE;
        layout.declared_line = 0;
        for field in &mut layout.fields {
            field.type_text = StrId::NONE;
            if layout.kind == LayoutKind::Environment {
                field.name = shortened(field.name);
            } else if let Some(&short) = short_members.get(&field.name) {
                field.name = short;
            }
        }
    }
    for global in &mut program.globals {
        if !(global.module.is_some() && is_module_of_runtime[global.module.idx()]) {
            global.name = shortened(global.name);
        }
    }
    for (module, _) in program.modules.iter_mut().zip(&is_module_of_runtime).filter(|(_, is_of_runtime)| !**is_of_runtime) {
        module.path = shortened(module.path);
        module.display_path = shortened(module.display_path);
    }

    shorten_private_names(program, &mut tokens, in_parallel);
    let is_mentioned: Vec<AtomicBool> = (0..program.strs.len()).map(|_| AtomicBool::new(false)).collect();
    let patterns = std::mem::take(&mut program.regexp_literals);
    for_each_string(program, false, in_parallel, &|id| {
        if !is_mentioned[id.idx()].load(Ordering::Relaxed) {
            is_mentioned[id.idx()].store(true, Ordering::Relaxed);
        }
    });
    let is_mentioned: Vec<bool> = is_mentioned.into_iter().map(AtomicBool::into_inner).collect();
    program.regexp_literals = patterns.into_iter().filter(|&(pattern, flags)| is_mentioned[pattern.idx()] && is_mentioned[flags.idx()]).collect();
    let mut kept = Strs::default();
    let mut numbers = vec![StrId::NONE; program.strs.len()];
    for original in (0..program.strs.len()).map(StrId::new) {
        for id in [Some(original), short.get(&original).copied()].into_iter().flatten() {
            if is_mentioned[id.idx()] && numbers[id.idx()].is_none() {
                numbers[id.idx()] = kept.add(program.strs.hash(id), program.strs.get(id));
            }
        }
    }
    for_each_string(program, true, in_parallel, &|id| *id = numbers[id.idx()]);
    program.strs = kept;
    Said { tokens: tokens.said, types }
}
