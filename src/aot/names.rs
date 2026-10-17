use crate::declared::{DeclaredTable, Part};
use crate::fragment::{Ids, Used, for_each_func_id, for_each_global_id, for_each_layout_id};
use crate::id::{FuncId, GlobalId, LayoutId, ModuleId, StrId, TyId, V};
use crate::ir::{
    CoerceReason, Def, FuncKind, LayoutKind, Op, Operation, Prediction, Program, Strs, field_flags,
    func_flags,
};
use bun_sema::atom::PRIVATE_NAME_PREFIX;
use bun_sema::util::{InParallel, for_each_mut};
use rustc_hash::FxHashMap;
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};

const FUNCTIONS_PER_SLICE: usize = 256;

pub(crate) const TDZ_MARKER: u8 = 0xfb;
const MEMBER_MARKER: u8 = 1;

pub(crate) fn tdz_error_message(name: &[u8]) -> Vec<u8> {
    [b"Cannot access '", name, b"' before initialization."].concat()
}

fn token_for_index(mut number: usize) -> Vec<u8> {
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

fn has_four_letter_run(text: &[u8]) -> bool {
    let mut letters = 0;
    text.iter().any(|character| {
        letters = if character.is_ascii_alphabetic() {
            letters + 1
        } else {
            0
        };
        letters == 4
    })
}

#[derive(Default)]
struct Tokens {
    next: usize,
    name_table: Vec<(Vec<u8>, Vec<u8>)>,
}

#[derive(Default)]
struct FreeTokens {
    bytes: Vec<u8>,
    lengths: Vec<u32>,
    hashes: Vec<u64>,
    numbers: Vec<usize>,
}

fn is_free_token(strs: &Strs, text: &[u8]) -> bool {
    text[1..].iter().any(u8::is_ascii_uppercase)
        && !has_four_letter_run(text)
        && strs.find(text).is_none()
}

impl Tokens {
    fn take(&mut self, strs: &Strs, original: &[u8]) -> Vec<u8> {
        loop {
            let text = token_for_index(self.next);
            self.next += 1;
            if is_free_token(strs, &text) {
                self.name_table.push((text.clone(), original.to_vec()));
                return text;
            }
        }
    }

    fn take_many(&mut self, strs: &Strs, count: usize, in_parallel: InParallel<'_>) -> FreeTokens {
        const NUMBERS_PER_RUN: usize = 4096;
        let mut taken = FreeTokens::default();
        while taken.lengths.len() < count {
            let first = self.next;
            let mut runs: Vec<(usize, FreeTokens)> = (0..(2 * (count - taken.lengths.len()))
                .div_ceil(NUMBERS_PER_RUN))
                .map(|run| (first + run * NUMBERS_PER_RUN, FreeTokens::default()))
                .collect();
            for_each_mut(&mut runs, in_parallel, &|(first, free)| {
                for number in *first..*first + NUMBERS_PER_RUN {
                    let text = token_for_index(number);
                    if is_free_token(strs, &text) {
                        free.bytes.extend_from_slice(&text);
                        free.lengths.push(text.len() as u32);
                        free.hashes.push(Strs::hash_of(&text));
                        free.numbers.push(number);
                    }
                }
            });
            for (first, free) in runs {
                let wanted = free.lengths.len().min(count - taken.lengths.len());
                let bytes: usize = free.lengths[..wanted]
                    .iter()
                    .map(|&length| length as usize)
                    .sum();
                taken.bytes.extend_from_slice(&free.bytes[..bytes]);
                taken.lengths.extend_from_slice(&free.lengths[..wanted]);
                taken.hashes.extend_from_slice(&free.hashes[..wanted]);
                self.next = if wanted == free.lengths.len() {
                    first + NUMBERS_PER_RUN
                } else {
                    free.numbers[wanted - 1] + 1
                };
                if taken.lengths.len() == count {
                    break;
                }
            }
        }
        taken
    }
}

pub(crate) struct NameTable {
    short_names: Vec<(StrId, StrId)>,
    tokens: Vec<(Vec<u8>, Vec<u8>)>,
    types: Vec<TypeNames>,
    strs: Strs,
}

struct TypeNames {
    name: StrId,
    declared_at: Option<(StrId, u32)>,
    members: Vec<(StrId, StrId)>,
}

fn push_quoted(json: &mut String, text: &[u8]) {
    json.push('"');
    match std::str::from_utf8(text) {
        Ok(plain)
            if !plain
                .bytes()
                .any(|byte| matches!(byte, b'"' | b'\\' | 0..=0x1f)) =>
        {
            json.push_str(plain)
        }
        _ => {
            for character in bstr::BStr::new(text).to_string().chars() {
                match character {
                    '"' | '\\' => json.extend(['\\', character]),
                    '\0'..='\x1f' => json.push_str(&format!("\\u{:04x}", character as u32)),
                    _ => json.push(character),
                }
            }
        }
    }
    json.push('"');
}

pub(crate) fn as_json(name_table: &NameTable) -> Vec<u8> {
    let mut json = String::from("{\n    \"positions\": \"original\",\n    \"tokens\": {");
    let short_names = name_table
        .short_names
        .iter()
        .map(|&(short, original)| (name_table.strs.get(short), name_table.strs.get(original)));
    for (number, (short, original)) in short_names
        .chain(
            name_table
                .tokens
                .iter()
                .map(|(short, original)| (&short[..], &original[..])),
        )
        .enumerate()
    {
        json.push_str(if number == 0 { "\n      " } else { ",\n      " });
        push_quoted(&mut json, short);
        json.push_str(": ");
        push_quoted(&mut json, original);
    }
    json.push_str("\n    },\n    \"types\": [");
    for (number, of_type) in name_table.types.iter().enumerate() {
        json.push_str(if number == 0 { "\n      " } else { ",\n      " });
        json.push_str("{ \"name\": ");
        push_quoted(
            &mut json,
            if of_type.name.is_some() {
                name_table.strs.get(of_type.name)
            } else {
                b""
            },
        );
        if let Some((path, line)) = of_type.declared_at {
            json.push_str(", \"at\": ");
            push_quoted(
                &mut json,
                &[name_table.strs.get(path), line.to_string().as_bytes()].join(&b':'),
            );
        }
        json.push_str(", \"members\": {");
        for (number, &(name, type_text)) in of_type.members.iter().enumerate() {
            json.push_str(if number == 0 { " " } else { ", " });
            push_quoted(&mut json, name_table.strs.get(name));
            json.push_str(": ");
            push_quoted(&mut json, name_table.strs.get(type_text));
        }
        json.push_str(" } }");
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

fn for_each_string(
    program: &mut Program,
    changes_names: bool,
    in_parallel: InParallel<'_>,
    each: &(impl Fn(&mut StrId) + Sync),
) {
    let mut funcs = std::mem::take(&mut program.funcs);
    let mut tys = std::mem::take(&mut program.tys);
    std::thread::scope(|scope| {
        scope.spawn(|| for_each_type_string(&mut tys, changes_names, each));
        scope.spawn(|| for_each_table_string(program, each));
        let mut slices: Vec<&mut [crate::ir::Func]> =
            funcs.chunks_mut(FUNCTIONS_PER_SLICE).collect();
        for_each_mut(&mut slices, in_parallel, &|funcs| {
            for func in funcs.iter_mut() {
                for_each_func_id(func, &mut Strings(|id: &mut StrId| each(id)));
            }
        });
    });
    program.funcs = funcs;
    program.tys = tys;
}

fn for_each_non_function_string(
    program: &mut Program,
    changes_names: bool,
    each: &impl Fn(&mut StrId),
) {
    for_each_type_string(&mut program.tys, changes_names, each);
    for_each_table_string(program, each);
}

fn for_each_type_string(tys: &mut DeclaredTable, changes_names: bool, each: &impl Fn(&mut StrId)) {
    let mut list = std::mem::take(&mut tys.list);
    for part in list.iter_mut().flat_map(|declared| &mut declared.parts) {
        if let Part::Global(name, _) = part {
            each(name);
        }
    }
    tys.list = list;
    if changes_names {
        tys.close();
    }
}

fn for_each_table_string(program: &mut Program, each: &impl Fn(&mut StrId)) {
    let Program {
        strs: _,
        tys: _,
        layouts,
        funcs: _,
        globals,
        modules,
        extended_globals,
        prototype_property_names,
        regexp_literals,
        webassembly_modules: _,
        logs_type_errors: _,
        flagged_values: _,
        builtin_modules: _,
        builtin_functions: _,
        functions_by_key,
        single_structure_accesses: _,
        declared_parameter_types: _,
        may_receive_untyped_arguments: _,
        known_slots: _,
        entries: _,
    } = program;
    let mut strings = Strings(|id: &mut StrId| each(id));
    for layout in layouts {
        for_each_layout_id(layout, &mut strings);
    }
    for global in globals {
        for_each_global_id(global, &mut strings);
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

struct PrivateNames {
    short: FxHashMap<Vec<u8>, StrId>,
    whole: FxHashMap<StrId, StrId>,
}

fn find_private_names(strs: &mut Strs, tokens: &mut Tokens) -> PrivateNames {
    let mut short: FxHashMap<Vec<u8>, StrId> = FxHashMap::default();
    let mut whole: FxHashMap<StrId, StrId> = FxHashMap::default();
    for id in (0..strs.len()).map(StrId::new) {
        let text = strs.get(id);
        let Some(at) = Some(text)
            .filter(|text| text.starts_with(PRIVATE_NAME_PREFIX))
            .and_then(|text| bun_core::strings::index_of_char_usize(text, b'@'))
        else {
            continue;
        };
        let (written, class) = (text[1..at].to_vec(), text[at..].to_vec());
        let token = match short.get(&written) {
            Some(&token) => token,
            None => {
                let text = [&b"#"[..], &tokens.take(strs, &written[1..])].concat();
                let token = strs.intern(&text);
                short.insert(written, token);
                token
            }
        };
        let text = [&PRIVATE_NAME_PREFIX[..1], strs.get(token), &class].concat();
        whole.insert(id, strs.intern(&text));
    }
    PrivateNames { short, whole }
}

const RUNTIME_FLAGS: u16 = func_flags::IS_BUILTIN | func_flags::IS_IN_BUILTIN_MODULE;

fn keeps_name(func: &crate::ir::Func) -> bool {
    func.flags & RUNTIME_FLAGS != 0 || func.kind == FuncKind::Method || func.module.is_none()
}

pub(crate) fn intern_tdz_names(strs: &mut Strs) -> Vec<(StrId, StrId)> {
    (0..strs.len())
        .map(StrId::new)
        .filter(|&id| strs.get(id).first() == Some(&TDZ_MARKER))
        .collect::<Vec<StrId>>()
        .into_iter()
        .map(|id| {
            let name = strs.get(id)[1..].to_vec();
            (id, strs.intern(&name))
        })
        .collect()
}

pub(crate) struct NameUses {
    is_runtime_module: Vec<bool>,
    is_runtime_layout: Vec<bool>,
    is_name_used: Vec<bool>,
    is_never_stored_member: Vec<bool>,
    bearers: Vec<(u32, u64, StrId)>,
    tokens: Tokens,
    free: FreeTokens,
}

pub(crate) fn count_uses(
    program: &Program,
    messages: &[(StrId, StrId)],
    in_parallel: InParallel<'_>,
) -> NameUses {
    let mut is_runtime_module = vec![false; program.modules.len()];
    for func in program
        .funcs
        .iter()
        .filter(|func| func.flags & RUNTIME_FLAGS != 0 && func.module.is_some())
    {
        is_runtime_module[func.module.idx()] = true;
    }
    let mut is_runtime_path = vec![false; program.strs.len()];
    for (module, _) in program
        .modules
        .iter()
        .zip(&is_runtime_module)
        .filter(|(_, is_runtime)| **is_runtime)
    {
        for path in [module.path, module.display_path]
            .into_iter()
            .filter(|path| path.is_some())
        {
            is_runtime_path[path.idx()] = true;
        }
    }
    let is_runtime_layout: Vec<bool> = (program.layouts.iter())
        .map(|layout| {
            (layout.constructor.is_some()
                && program.funcs[layout.constructor.idx()].flags & RUNTIME_FLAGS != 0)
                || (layout.declared_path.is_some()
                    && (is_runtime_path[layout.declared_path.idx()]
                        || program
                            .strs
                            .get(layout.declared_path)
                            .starts_with(bun_builtin_syntax::VIRTUAL_ROOT)))
        })
        .collect();

    let is_name_used: Vec<AtomicBool> = (0..program.strs.len())
        .map(|_| AtomicBool::new(false))
        .collect();
    let bearer_count: Vec<AtomicU32> = (0..program.strs.len()).map(|_| AtomicU32::new(0)).collect();
    let mut is_never_stored_member = vec![false; program.strs.len()];
    let spell = |id: StrId| {
        if id.is_some() && !is_name_used[id.idx()].load(Ordering::Relaxed) {
            is_name_used[id.idx()].store(true, Ordering::Relaxed);
        }
    };
    let bear = |id: StrId| {
        if id.is_some() {
            bearer_count[id.idx()].fetch_add(1, Ordering::Relaxed);
        }
    };
    let mut slices: Vec<&[crate::ir::Func]> = program.funcs.chunks(FUNCTIONS_PER_SLICE).collect();
    for_each_mut(&mut slices, in_parallel, &|funcs| {
        for func in funcs.iter() {
            if keeps_name(func) {
                spell(func.name)
            } else {
                bear(func.name)
            }
            for value in &func.values {
                if let Prediction::ByKey(property) = value.prediction() {
                    spell(property);
                }
                let Def::Op(op) = &value.def else { continue };
                match *op {
                    Op::Str(text)
                    | Op::BigInt(text)
                    | Op::Symbol(text)
                    | Op::ExternalModule(text) => spell(text),
                    Op::FreeGet { name, .. }
                    | Op::FreeSet { name, .. }
                    | Op::PropGet { name, .. }
                    | Op::PropSet { name, .. }
                    | Op::PropHas { name, .. }
                    | Op::PropDelete { name, .. }
                    | Op::CallMethod { name, .. }
                    | Op::NewWith { name, .. } => spell(name),
                    Op::FieldGet { layout, field, .. } | Op::FieldSet { layout, field, .. }
                        if program.layouts[layout.idx()].kind != LayoutKind::Environment =>
                    {
                        spell(program.layouts[layout.idx()].fields[field as usize].name)
                    }
                    Op::Coerce {
                        why: CoerceReason::NonNull(text),
                        ..
                    } => {
                        if func.flags & RUNTIME_FLAGS != 0 {
                            spell(text)
                        } else {
                            bear(text)
                        }
                    }
                    _ => {}
                }
            }
        }
    });
    for (layout, &is_runtime) in program.layouts.iter().zip(&is_runtime_layout) {
        if is_runtime {
            spell(layout.name)
        } else {
            bear(layout.name)
        }
        for field in &layout.fields {
            if layout.kind == LayoutKind::Environment {
                bear(field.name);
            } else if is_runtime
                || field.flags & field_flags::NEVER_STORED == 0
                || field.name.is_none()
            {
                spell(field.name);
            } else {
                is_never_stored_member[field.name.idx()] = true;
            }
            if is_runtime {
                spell(field.type_text);
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
        if global.module.is_some() && is_runtime_module[global.module.idx()] {
            spell(global.name)
        } else {
            bear(global.name)
        }
    }
    for part in program.tys.list.iter().flat_map(|declared| &declared.parts) {
        if let Part::Global(name, _) = *part {
            spell(name);
        }
    }
    for &name in program
        .extended_globals
        .iter()
        .chain(&program.prototype_property_names)
    {
        spell(name);
    }
    for &(property, key, _) in &program.functions_by_key {
        spell(property);
        spell(key);
    }
    for &(_, name) in messages {
        bear(name);
    }
    for (module, _) in program
        .modules
        .iter()
        .zip(&is_runtime_module)
        .filter(|(_, is_runtime)| !**is_runtime)
    {
        bear(module.path);
        bear(module.display_path);
    }
    for (path, _) in is_runtime_path
        .iter()
        .enumerate()
        .filter(|(_, is_runtime)| **is_runtime)
    {
        spell(StrId::new(path));
    }
    let is_name_used: Vec<bool> = is_name_used
        .into_iter()
        .map(AtomicBool::into_inner)
        .collect();
    let bearer_count: Vec<u32> = bearer_count
        .into_iter()
        .map(AtomicU32::into_inner)
        .collect();
    let is_path: Vec<bool> = {
        let mut is_path = vec![false; program.strs.len()];
        for path in program
            .modules
            .iter()
            .flat_map(|module| [module.path, module.display_path])
            .filter(|path| path.is_some() && !is_runtime_path[path.idx()])
        {
            is_path[path.idx()] = true;
        }
        is_path
    };

    let first_bytes = |id: StrId| {
        let (text, mut first) = (program.strs.get(id), [0; 8]);
        let length = text.len().min(first.len());
        first[..length].copy_from_slice(&text[..length]);
        u64::from_be_bytes(first)
    };
    let mut bearers: Vec<(u32, u64, StrId)> = (0..program.strs.len())
        .map(StrId::new)
        .filter(|id| {
            bearer_count[id.idx()] != 0
                && (!is_name_used[id.idx()] || is_path[id.idx()])
                && !program.strs.get(*id).is_empty()
                && !program.strs.get(*id).starts_with(PRIVATE_NAME_PREFIX)
        })
        .map(|id| (bearer_count[id.idx()], first_bytes(id), id))
        .collect();
    bearers.sort_unstable_by(|a, b| {
        b.0.cmp(&a.0)
            .then_with(|| a.1.cmp(&b.1))
            .then_with(|| program.strs.get(a.2).cmp(program.strs.get(b.2)))
    });
    let mut tokens = Tokens::default();
    let free = tokens.take_many(&program.strs, bearers.len(), in_parallel);
    NameUses {
        is_runtime_module,
        is_runtime_layout,
        is_name_used,
        is_never_stored_member,
        bearers,
        tokens,
        free,
    }
}

pub(crate) fn shorten(
    program: &mut Program,
    messages: &[(StrId, StrId)],
    uses: NameUses,
    in_parallel: InParallel<'_>,
) -> NameTable {
    let NameUses {
        is_runtime_module,
        is_runtime_layout,
        is_name_used,
        is_never_stored_member,
        bearers,
        mut tokens,
        free,
    } = uses;
    let mut short = vec![StrId::NONE; program.strs.len()];
    let first_token = program.strs.len();
    program
        .strs
        .add_all(&free.bytes, &free.lengths, &free.hashes);
    let short_names: Vec<(StrId, StrId)> = bearers
        .iter()
        .enumerate()
        .map(|(place, &(_, _, original))| (StrId::new(first_token + place), original))
        .collect();
    for &(token, original) in &short_names {
        short[original.idx()] = token;
    }
    let mut short_members: FxHashMap<StrId, StrId> = FxHashMap::default();
    let members: Vec<StrId> = (0..is_never_stored_member.len())
        .map(StrId::new)
        .filter(|id| {
            is_never_stored_member[id.idx()]
                && !is_name_used[id.idx()]
                && !program.strs.get(*id).starts_with(PRIVATE_NAME_PREFIX)
        })
        .collect();
    for (number, &original) in members.iter().enumerate() {
        let text = [&[MEMBER_MARKER][..], &token_for_index(number)].concat();
        short_members.insert(original, program.strs.intern(&text));
    }
    let short_of = |id: StrId| short.get(id.idx()).copied().filter(|short| short.is_some());
    let shortened = |id: StrId| short_of(id).unwrap_or(id);

    let final_messages: FxHashMap<StrId, StrId> = (messages.iter())
        .map(|&(message, name)| {
            let text = tdz_error_message(&program.strs.get(shortened(name)).to_vec());
            (message, program.strs.intern(&text))
        })
        .collect();
    let private = find_private_names(&mut program.strs, &mut tokens);
    let mut private_method_name_counts: FxHashMap<usize, u32> = FxHashMap::default();
    for method in program
        .layouts
        .iter()
        .flat_map(|layout| &layout.methods)
        .filter(|method| method.func.is_some() && private.whole.contains_key(&method.name))
    {
        *private_method_name_counts
            .entry(method.func.idx())
            .or_default() += 1;
    }
    let strs = std::mem::take(&mut program.strs);
    let mut funcs = std::mem::take(&mut program.funcs);
    let is_mentioned: Vec<AtomicBool> = (0..strs.len()).map(|_| AtomicBool::new(false)).collect();
    let mention = |id: &mut StrId| {
        if !is_mentioned[id.idx()].load(Ordering::Relaxed) {
            is_mentioned[id.idx()].store(true, Ordering::Relaxed);
        }
    };
    let insert_private_name = |id: &mut StrId| {
        if let Some(&short) = private.whole.get(id) {
            *id = short;
        }
    };
    let mut types: Vec<TypeNames> = Vec::new();
    let mut patterns = Vec::new();
    std::thread::scope(|scope| {
        scope.spawn(|| {
            for (layout, &is_runtime) in program.layouts.iter_mut().zip(&is_runtime_layout) {
                if is_runtime {
                    continue;
                }
                layout.name = shortened(layout.name);
                if layout.declared_path.is_some()
                    || layout.fields.iter().any(|field| field.type_text.is_some())
                {
                    types.push(TypeNames {
                        name: layout.name,
                        declared_at: layout
                            .declared_path
                            .is_some()
                            .then_some((layout.declared_path, layout.declared_line)),
                        members: layout
                            .fields
                            .iter()
                            .filter(|field| field.type_text.is_some() && field.name.is_some())
                            .map(|field| (field.name, field.type_text))
                            .collect(),
                    });
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
                if !(global.module.is_some() && is_runtime_module[global.module.idx()]) {
                    global.name = shortened(global.name);
                }
            }
            for (module, _) in program
                .modules
                .iter_mut()
                .zip(&is_runtime_module)
                .filter(|(_, is_runtime)| !**is_runtime)
            {
                module.path = shortened(module.path);
                module.display_path = shortened(module.display_path);
            }
            if !private.whole.is_empty() {
                for_each_non_function_string(program, false, &insert_private_name);
            }
            patterns = std::mem::take(&mut program.regexp_literals);
            for_each_non_function_string(program, false, &mention);
        });
        let mut slices: Vec<(usize, &mut [crate::ir::Func])> =
            funcs.chunks_mut(FUNCTIONS_PER_SLICE).enumerate().collect();
        for_each_mut(&mut slices, in_parallel, &|(slice, funcs)| {
            for (place, func) in funcs.iter_mut().enumerate() {
                let is_runtime = func.flags & RUNTIME_FLAGS != 0;
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
                        Def::Op(Op::Coerce {
                            why: CoerceReason::NonNull(text),
                            ..
                        }) if !is_runtime => *text = shortened(*text),
                        _ => {}
                    }
                }
                if !private.whole.is_empty() {
                    for _ in 0..private_method_name_counts
                        .get(&(*slice * FUNCTIONS_PER_SLICE + place))
                        .copied()
                        .unwrap_or(0)
                    {
                        if let Some(&token) = Some(func.name)
                            .filter(|name| name.is_some())
                            .and_then(|name| private.short.get(strs.get(name)))
                        {
                            func.name = token;
                        }
                    }
                    let texts: Vec<V> = (func.values.iter())
                        .filter_map(|value| match &value.def {
                            Def::Op(Op::Operation {
                                which: Operation::NewPrivateName,
                                args,
                            }) => args.first().copied(),
                            _ => None,
                        })
                        .collect();
                    for text in texts {
                        if let Def::Op(Op::Str(written)) = &mut func.values[text.idx()].def
                            && let Some(&token) = private.short.get(strs.get(*written))
                        {
                            *written = token;
                        }
                    }
                }
                for_each_func_id(
                    func,
                    &mut Strings(|id: &mut StrId| {
                        insert_private_name(id);
                        mention(id);
                    }),
                );
            }
        });
    });
    program.funcs = funcs;
    let is_mentioned: Vec<bool> = is_mentioned
        .into_iter()
        .map(AtomicBool::into_inner)
        .collect();
    program.regexp_literals = patterns
        .into_iter()
        .filter(|&(pattern, flags)| is_mentioned[pattern.idx()] && is_mentioned[flags.idx()])
        .collect();
    let mut kept_ids: Vec<StrId> = Vec::with_capacity(
        is_mentioned
            .iter()
            .filter(|is_mentioned| **is_mentioned)
            .count(),
    );
    let mut numbers = vec![StrId::NONE; strs.len()];
    for original in (0..strs.len()).map(StrId::new) {
        for id in [Some(original), short_of(original)].into_iter().flatten() {
            if is_mentioned[id.idx()] && numbers[id.idx()].is_none() {
                numbers[id.idx()] = StrId::new(kept_ids.len());
                kept_ids.push(id);
            }
        }
    }
    program.strs = std::thread::scope(|scope| {
        let retained = scope.spawn(|| {
            let mut retained = Strs::unindexed_with_capacities(
                kept_ids.len(),
                kept_ids.iter().map(|&id| strs.get(id).len()).sum(),
            );
            for &id in &kept_ids {
                retained.add_unindexed(strs.hash(id), strs.get(id));
            }
            retained
        });
        for_each_string(program, true, in_parallel, &|id| *id = numbers[id.idx()]);
        retained
            .join()
            .expect("the thread that lays the strings that are kept panicked")
    });
    NameTable {
        short_names,
        tokens: tokens.name_table,
        types,
        strs,
    }
}

#[cfg(test)]
mod tests {
    use super::{Strs, Tokens, has_four_letter_run};

    #[test]
    fn tokens_have_no_four_letter_run() {
        let (strs, mut tokens) = (Strs::default(), Tokens::default());
        let taken: Vec<Vec<u8>> = (0..200_000).map(|_| tokens.take(&strs, b"name")).collect();
        assert!(taken.iter().all(|token| !has_four_letter_run(token)));
        assert_eq!(
            [2, 3, 4].map(|length| taken.iter().filter(|token| token.len() == length).count()),
            [676, 66_248, 133_076]
        );
    }
}
