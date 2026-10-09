//! Why the link finds that a fragment takes something for what it is not, or that nobody defines a class. For whoever may not see the
//! program: numbers, kinds and the words of this crate, and no name and no text of the program.

use super::{At, By, Elsewhere, Finder, Index, Reach, place_of_error};
use crate::declared::{DeclaredTable, Part, prim};
use crate::fragment::{Fragment, FuncKey, Function, GlobalKey, LayoutKey, NO_FILE, Shape, Variable};
use crate::id::{FuncId, LayoutId, StrId, TyId};
use crate::ir::{Def, Func, Layout, LayoutKind, Literal, NO_VARIABLE, Op, Prediction, STATIC_FIELD_IS_ANNOTATED, Strs, class_flags, field_flags, func_flags, method_flags, only_function_flags};
use bun_sema::bind::{ClassOwner, FnOwner, Parent, SymFlags};
use bun_sema::check::{Identity, Program as Checked};
use bun_sema::hir::{Flags, FnId, PatKind, TypeNodeKind};
use bun_sema::program::FileId;

/// How many differences are spelled out for one thing.
const MOST_DIFFERENCES: usize = 6;
/// How far into the arguments and the elements of a type its text goes.
const DEPTH_OF_TYPES: usize = 4;

const PRIMS: [(u32, &str); 8] = [
    (prim::UNDEFINED, "undefined"),
    (prim::NULL, "null"),
    (prim::FALSE, "false"),
    (prim::TRUE, "true"),
    (prim::NUMBER, "number"),
    (prim::STRING, "string"),
    (prim::SYMBOL, "symbol"),
    (prim::BIGINT, "bigint"),
];
const FIELD_FLAGS: [(u32, &str); 13] = [
    (field_flags::OPTIONAL as u32, "OPTIONAL"),
    (field_flags::EXPECTED_INT32 as u32, "EXPECTED_INT32"),
    (field_flags::IMMUTABLE as u32, "IMMUTABLE"),
    (field_flags::METHOD as u32, "METHOD"),
    (field_flags::ANNOTATED as u32, "ANNOTATED"),
    (field_flags::NEVER_SEEN_UNINITIALIZED as u32, "NEVER_SEEN_UNINITIALIZED"),
    (field_flags::STORED_ONCE as u32, "STORED_ONCE"),
    (field_flags::NEVER_STORED as u32, "NEVER_STORED"),
    (field_flags::SET_AT_CREATION as u32, "SET_AT_CREATION"),
    (field_flags::MAY_BE_SET_AT_CREATION as u32, "MAY_BE_SET_AT_CREATION"),
    (field_flags::ABSENT_AT_BIRTH as u32, "ABSENT_AT_BIRTH"),
    (field_flags::NEVER_SEEN_ABSENT as u32, "NEVER_SEEN_ABSENT"),
    (field_flags::DECLARED_WITHOUT_UNDEFINED as u32, "DECLARED_WITHOUT_UNDEFINED"),
];
const ONLY_FUNCTION_FLAGS: [(u32, &str); 2] = [(only_function_flags::IS_FACT as u32, "IS_FACT"), (only_function_flags::OR_NIL as u32, "OR_NIL")];
const CLASS_FLAGS: [(u32, &str); 6] = [
    (class_flags::IS_LAID_OUT, "IS_LAID_OUT"),
    (class_flags::IS_EVALUATED_ONCE, "IS_EVALUATED_ONCE"),
    (class_flags::HAS_FOREIGN_ROOT, "HAS_FOREIGN_ROOT"),
    (class_flags::HAS_FIXED_MEMBERS, "HAS_FIXED_MEMBERS"),
    (class_flags::MAY_HAVE_OTHER_PROTOTYPE, "MAY_HAVE_OTHER_PROTOTYPE"),
    (class_flags::HAS_STATIC_MEMBER_OF_UNKNOWN_NAME, "HAS_STATIC_MEMBER_OF_UNKNOWN_NAME"),
];
const METHOD_FLAGS: [(u32, &str); 3] = [(method_flags::STATIC as u32, "STATIC"), (method_flags::KEY_IS_SYMBOL as u32, "KEY_IS_SYMBOL"), (method_flags::MAY_BE_REPLACED as u32, "MAY_BE_REPLACED")];
const FUNC_FLAGS: [(u32, &str); 9] = [
    (func_flags::ASYNC as u32, "ASYNC"),
    (func_flags::GENERATOR as u32, "GENERATOR"),
    (func_flags::IS_VALUE as u32, "IS_VALUE"),
    (func_flags::HAS_REST as u32, "HAS_REST"),
    (func_flags::HAS_THIS as u32, "HAS_THIS"),
    (func_flags::STARTS_EAGERLY as u32, "STARTS_EAGERLY"),
    (func_flags::IS_TYPED as u32, "IS_TYPED"),
    (func_flags::HAS_NEW_TARGET as u32, "HAS_NEW_TARGET"),
    (func_flags::IS_OF_BUILTIN_MODULE as u32, "IS_OF_BUILTIN_MODULE"),
];
const SYMBOL_FLAGS: [(SymFlags, &str); 6] = [
    (SymFlags::CLASS, "CLASS"),
    (SymFlags::INTERFACE, "INTERFACE"),
    (SymFlags::VALUE_MODULE, "VALUE_MODULE"),
    (SymFlags::NAMESPACE_MODULE, "NAMESPACE_MODULE"),
    (SymFlags::ALIAS, "ALIAS"),
    (SymFlags::MERGED, "MERGED"),
];

/// The word in hexadecimal, and the bits of it that have names.
fn bits(word: u32, names: &[(u32, &str)]) -> String {
    let set: Vec<&str> = names.iter().filter(|name| word & name.0 != 0).map(|name| name.1).collect();
    format!("{word:#x} ({})", set.join(" "))
}

fn yes_or_no(is_so: bool) -> &'static str {
    if is_so { "yes" } else { "no" }
}

fn number_or(number: Option<u32>, otherwise: &str) -> String {
    number.map_or_else(|| otherwise.to_owned(), |number| number.to_string())
}

fn kind_of_key(key: LayoutKey) -> LayoutKind {
    match key {
        LayoutKey::Record(_) => LayoutKind::Record,
        LayoutKey::Instance(..) => LayoutKind::Instance,
        LayoutKey::ClassEnvironment(..) | LayoutKey::Environment(..) => LayoutKind::Environment,
    }
}

/// The specifier of a module is text of the program.
fn text_of_global_key(key: &GlobalKey) -> String {
    match key {
        GlobalKey::ExternalModule(_) => "ExternalModule".to_owned(),
        key => format!("{key:?}"),
    }
}

/// A type in the notation of the dump, with what `layout` and `global` make of a layout and of the name of a class of the engine.
fn text_of_ty(tys: &DeclaredTable, ty: TyId, layout: &dyn Fn(LayoutId) -> String, global: &dyn Fn(StrId) -> String, depth: usize) -> String {
    if ty.is_none() {
        return "-".to_owned();
    }
    if depth == 0 {
        return "..".to_owned();
    }
    let declared = tys.get(ty);
    let within = |ty: TyId| text_of_ty(tys, ty, layout, global, depth - 1);
    let mut parts: Vec<String> = PRIMS.iter().filter(|prim| declared.prims & prim.0 != 0).map(|prim| prim.1.to_owned()).collect();
    parts.extend(declared.ints.map(|(least, most)| format!("int[{least},{most}]")));
    parts.extend(declared.any_object.then(|| "object".to_owned()));
    parts.extend(declared.any_function.then(|| "function".to_owned()));
    parts.extend(declared.parts.iter().map(|part| match part {
        Part::Class(named) => layout(*named),
        Part::Global(name, arguments) => format!("{}<{}>", global(*name), arguments.iter().map(|&argument| within(argument)).collect::<Vec<String>>().join(", ")),
        Part::Array(element) => format!("[{}]", within(*element)),
    }));
    if parts.is_empty() { "never".to_owned() } else { parts.join(" | ") }
}

/// What the link has kept of each thing, and what there is to say of each fragment.
pub(super) struct Kept<'a> {
    pub(super) fragments: &'a [Fragment],
    /// By number in the program: where the definition was.
    pub(super) layouts: &'a [At],
    pub(super) globals: &'a [At],
    /// How many entry functions there are. They are the first functions of the program, and the link's own.
    pub(super) entries: usize,
    /// By number in the program, less that.
    pub(super) funcs: &'a [(At, bool)],
    /// By fragment: `about_fragment`.
    pub(super) about: &'a [String],
    /// `Checker::explain_identities`, of two types by what fragments call them.
    pub(super) explain_identities: &'a (dyn Fn(Identity, Identity) -> String + Sync),
    /// `about_function`
    pub(super) about_function: &'a (dyn Fn(FileId, FnId) -> String + Sync),
}

/// The function as it is written: what its parameters get their types from.
pub(super) fn about_function(checked: &Checked<'_>, file: FileId, func: FnId) -> String {
    let (hir, bound) = (checked.files.hir(file), checked.files.bound(file));
    let written = &hir[func];
    let parameters: Vec<String> = (written.params.iter())
        .map(|param| {
            let pattern = match hir[hir[param].pat].kind {
                PatKind::Ident(_) => "a name",
                PatKind::Object(..) => "an object pattern",
                PatKind::Array(..) => "an array pattern",
                _ => "another pattern",
            };
            let annotation = hir[param].ty;
            let annotated = if annotation.is_none() { "not annotated".to_owned() } else { format!("annotated with {}", kind_of_type_node(&hir[annotation].kind)) };
            format!("{pattern}, {annotated}, default: {}", yes_or_no(hir[param].default.is_some()))
        })
        .collect();
    // What is around a function expression, from the inside out.
    let mut around = Vec::new();
    if let FnOwner::Expr(mut e) = bound.fns[func.idx()].owner {
        while around.len() < 6 {
            match bound.expr_parent[e.idx()] {
                Parent::Expr(parent) => {
                    around.push(format!("{:?}", hir[parent].kind.tag()));
                    e = parent;
                }
                Parent::VarInit(declaration) => {
                    around.push(format!("the initializer of a variable, annotated: {}", yes_or_no(hir[declaration].ty.is_some())));
                    break;
                }
                parent => {
                    around.push(format!("{parent:?}"));
                    break;
                }
            }
        }
    }
    format!(
        "as it is written: {:?}, owner {:?}, type parameters: {}, return type annotated: {}, parameters [{}], around it [{}]",
        written.kind,
        bound.fns[func.idx()].owner,
        written.type_params.len(),
        yes_or_no(written.ret.is_some()),
        parameters.join("; "),
        around.join(", "),
    )
}

fn kind_of_type_node(kind: &TypeNodeKind) -> &'static str {
    match kind {
        TypeNodeKind::Ref { args, .. } if args.is_empty() => "a type reference without type arguments",
        TypeNodeKind::Ref { .. } => "a type reference with type arguments",
        TypeNodeKind::Object(_) => "a type literal",
        TypeNodeKind::Intersection(_) => "an intersection",
        TypeNodeKind::Union(_) => "a union",
        TypeNodeKind::Mapped(_) => "a mapped type",
        TypeNodeKind::IndexedAccess { .. } => "an indexed access",
        TypeNodeKind::Cond { .. } => "a conditional type",
        TypeNodeKind::Typeof { .. } => "`typeof`",
        TypeNodeKind::Import { .. } => "an import type",
        _ => "another type node",
    }
}

pub(super) fn about_file(checked: &Checked<'_>, index: &Index, reach: &Reach, file: FileId) -> String {
    let (hir, module) = (checked.files.hir(file), checked.files.module(file));
    format!(
        "file {} ({:?}{}{}), a module of the program: {}, has a fragment: {}",
        file.0,
        hir.kind,
        if hir.is_js { ", JavaScript" } else { "" },
        if module.is_only_code { ", only code" } else { "" },
        yes_or_no(reach.bodies.contains(&FuncKey::Module(file))),
        yes_or_no(index.by_file.contains_key(&file)),
    )
}

pub(super) fn about_fragment(checked: &Checked<'_>, index: &Index, reach: &Reach, fragment: &Fragment) -> String {
    if fragment.file == NO_FILE {
        return "a fragment that the link has described".to_owned();
    }
    format!("the fragment of {}, translated {} times", about_file(checked, index, reach, fragment.file), fragment.times_translated)
}

impl Finder<'_> {
    fn layout_here(&self, local: LayoutId) -> String {
        if local.is_none() {
            return "-".to_owned();
        }
        let key = self.fragment.layouts[local.idx()].key;
        format!("#{:?}:{}", kind_of_key(key), number_or(self.all.layouts.get(&key).map(|id| id.0), "absent"))
    }

    fn layout_kept(&self, id: LayoutId) -> String {
        if id.is_none() { "-".to_owned() } else { format!("#{:?}:{}", self.all.program.layouts[id.idx()].kind, id.0) }
    }

    fn func_here(&self, local: FuncId) -> String {
        if local.is_none() { "-".to_owned() } else { self.func(local).map_or_else(|| "absent".to_owned(), |id| format!("f{}", id.0)) }
    }

    fn func_kept(&self, id: FuncId) -> String {
        if id.is_none() { "-".to_owned() } else { format!("f{}", id.0) }
    }

    fn ty_here(&self, local: TyId) -> String {
        let global = |name: StrId| format!("global:{}", number_or(self.str(name).map(|id| id.0), "absent"));
        text_of_ty(&self.fragment.tys, local, &|named| self.layout_here(named), &global, DEPTH_OF_TYPES)
    }

    fn ty_kept(&self, ty: TyId) -> String {
        text_of_ty(&self.all.program.tys, ty, &|named| self.layout_kept(named), &|name| format!("global:{}", name.0), DEPTH_OF_TYPES)
    }

    /// Where each of the two types is objects of one layout, and not of the same: how the two layouts compare.
    fn about_the_layouts_of(&self, kept: &Kept<'_>, local: TyId, out: TyId) -> String {
        if local.is_none() || out.is_none() {
            return String::new();
        }
        let only_class = |parts: &[Part]| match parts {
            [Part::Class(named)] => Some(*named),
            _ => None,
        };
        let (Some(here), Some(there)) = (only_class(&self.fragment.tys.get(local).parts), only_class(&self.all.program.tys.get(out).parts)) else { return String::new() };
        let shape = &self.fragment.layouts[here.idx()];
        if self.layout(here) == Some(there) {
            return String::new();
        }
        if there.is_none() {
            return "; the layout of the kept type is absent from the program".to_owned();
        }
        let (other, at) = (&self.all.program.layouts[there.idx()], kept.layouts[there.idx()]);
        let name_of = |strs: &Strs, name: StrId| name.is_some().then(|| strs.get(name).to_vec());
        let key_kept = kept.fragments[at.fragment as usize].layouts[at.index as usize].key;
        let about_types = match (shape.key, key_kept) {
            (LayoutKey::Record(here), LayoutKey::Record(there)) => (kept.explain_identities)(here, there),
            _ => "they are not both records".to_owned(),
        };
        format!(
            "; the layouts: keys here {:x?}, kept {:x?}; names equal: {}; fields here {}, kept {}; {about_types}",
            shape.key,
            key_kept,
            yes_or_no(name_of(&self.fragment.strs, shape.name) == name_of(&self.all.program.strs, other.name)),
            shape.definition.as_ref().map_or_else(|| "unknown, it is only named".to_owned(), |definition| definition.layout.fields.len().to_string()),
            other.fields.len(),
        )
    }

    fn difference_of_tys(&mut self, kept: &Kept<'_>, what: &str, local: TyId, out: TyId) -> Option<String> {
        let found = self.ty(local);
        (found != Some(out)).then(|| {
            let found = found.map_or_else(|| "the program has no such type".to_owned(), |id| format!("in the program it is type {}, the kept one is type {}", number_or(id.is_some().then_some(id.0), "-"), number_or(out.is_some().then_some(out.0), "-")));
            format!("{what}: here {}, kept {} ({found}){}", self.ty_here(local), self.ty_kept(out), self.about_the_layouts_of(kept, local, out))
        })
    }

    fn difference_of_only_functions(&self, what: &str, local: (FuncId, u8), out: (FuncId, u8)) -> Option<String> {
        (!self.is_only_function(local.0, local.1, out.0, out.1)).then(|| {
            format!("{what}: only_function here {} flags {}, kept {} flags {}", self.func_here(local.0), bits(local.1 as u32, &ONLY_FUNCTION_FLAGS), self.func_kept(out.0), bits(out.1 as u32, &ONLY_FUNCTION_FLAGS))
        })
    }

    /// Every component in which `is_layout` finds a difference, in its order.
    fn differences_of_layouts(&mut self, kept: &Kept<'_>, local: &Layout, id: LayoutId) -> Vec<String> {
        let all = self.all;
        let out = &all.program.layouts[id.idx()];
        let lists_methods = local.kind != LayoutKind::Record;
        let mut found: Vec<String> = Vec::new();
        if local.kind != out.kind {
            found.push(format!("kind: here {:?}, kept {:?}", local.kind, out.kind));
        }
        if (local.class_flags ^ out.class_flags) & !class_flags::MAY_HAVE_OTHER_PROTOTYPE != 0 {
            found.push(format!("class flags: here {}, kept {}", bits(local.class_flags, &CLASS_FLAGS), bits(out.class_flags, &CLASS_FLAGS)));
        }
        if local.fields.len() != out.fields.len() {
            found.push(format!("number of fields: here {}, kept {}", local.fields.len(), out.fields.len()));
        }
        if lists_methods && local.methods.len() != out.methods.len() {
            found.push(format!("number of methods: here {}, kept {}", local.methods.len(), out.methods.len()));
        }
        if local.static_fields.len() != out.static_fields.len() {
            found.push(format!("number of static fields: here {}, kept {}", local.static_fields.len(), out.static_fields.len()));
        }
        if self.layout(local.base) != Some(out.base) {
            found.push(format!("base: here {}, kept {}", self.layout_here(local.base), self.layout_kept(out.base)));
        }
        if self.layout(local.environment) != Some(out.environment) {
            found.push(format!("environment of the class: here {}, kept {}", self.layout_here(local.environment), self.layout_kept(out.environment)));
        }
        if self.func(local.constructor) != Some(out.constructor) {
            found.push(format!("constructor: here {}, kept {}", self.func_here(local.constructor), self.func_kept(out.constructor)));
        }
        for (i, (field, same)) in local.fields.iter().zip(&out.fields).enumerate() {
            if field.flags != same.flags {
                found.push(format!("field {i}: flags: here {}, kept {}", bits(field.flags as u32, &FIELD_FLAGS), bits(same.flags as u32, &FIELD_FLAGS)));
            }
            if self.str(field.name) != Some(same.name) {
                let in_kept = self.str(field.name).and_then(|name| out.field(name));
                let in_this = local.fields.iter().position(|other| self.str(other.name) == Some(same.name)).map(|at| at as u32);
                found.push(format!("field {i}: the names differ; the kept layout has the name of this one at {}, this one has the name of the kept one at {}", number_or(in_kept, "no index"), number_or(in_this, "no index")));
            }
            found.extend(self.difference_of_tys(kept, &format!("field {i}: declared type"), field.declared, same.declared));
            found.extend(self.difference_of_only_functions(&format!("field {i}"), (field.only_function, field.only_function_flags), (same.only_function, same.only_function_flags)));
            let is_same_literal = |(literal, same): (&Literal, &Literal)| match (*literal, *same) {
                (Literal::Str(text), Literal::Str(same)) => self.str(text) == Some(same),
                (Literal::Num(number), Literal::Num(same)) => number.to_bits() == same.to_bits(),
                _ => false,
            };
            if field.literals.len() != same.literals.len() || !field.literals.iter().zip(&same.literals).all(is_same_literal) {
                let strings = |literals: &[Literal]| literals.iter().filter(|literal| matches!(literal, Literal::Str(_))).count();
                found.push(format!("field {i}: literals: here {} of which {} strings, kept {} of which {} strings", field.literals.len(), strings(&field.literals), same.literals.len(), strings(&same.literals)));
            }
        }
        let has_module_variables = local.environment.is_none();
        let variable = |variable: Option<u32>| match variable {
            None => "absent".to_owned(),
            Some(NO_VARIABLE) => "-".to_owned(),
            Some(variable) => format!("{}{}", variable & !STATIC_FIELD_IS_ANNOTATED, if variable & STATIC_FIELD_IS_ANNOTATED != 0 { " annotated" } else { "" }),
        };
        for (i, (method, same)) in local.methods.iter().zip(&out.methods).enumerate().filter(|_| lists_methods) {
            if method.kind != same.kind {
                found.push(format!("method {i}: kind: here {:?}, kept {:?}", method.kind, same.kind));
            }
            if method.flags != same.flags {
                found.push(format!("method {i}: flags: here {}, kept {}", bits(method.flags as u32, &METHOD_FLAGS), bits(same.flags as u32, &METHOD_FLAGS)));
            }
            if self.str(method.name) != Some(same.name) {
                found.push(format!("method {i}: the names differ"));
            }
            if self.func(method.func) != Some(same.func) {
                found.push(format!("method {i}: function: here {}, kept {}", self.func_here(method.func), self.func_kept(same.func)));
            }
            if self.variable(method.key, 0, has_module_variables) != Some(same.key) {
                found.push(format!("method {i}: variable of the key: here {}, kept {}", variable(self.variable(method.key, 0, has_module_variables)), variable(Some(same.key))));
            }
        }
        for (i, (field, same)) in local.static_fields.iter().zip(&out.static_fields).enumerate() {
            if self.str(field.0) != Some(same.0) {
                found.push(format!("static field {i}: the names differ"));
            }
            if self.variable(field.1, STATIC_FIELD_IS_ANNOTATED, has_module_variables) != Some(same.1) {
                found.push(format!("static field {i}: variable: here {}, kept {}", variable(self.variable(field.1, STATIC_FIELD_IS_ANNOTATED, has_module_variables)), variable(Some(same.1))));
            }
        }
        found
    }

    /// The same for `is_func`.
    fn differences_of_funcs(&mut self, kept: &Kept<'_>, local: &Func, id: FuncId) -> Vec<String> {
        let all = self.all;
        let out = &all.program.funcs[id.idx()];
        let known_later = func_flags::IS_VALUE | func_flags::IS_TYPED | if all.is_stub[id.idx()] { super::COROUTINE } else { 0 };
        let mut found: Vec<String> = Vec::new();
        if local.kind != out.kind {
            found.push(format!("kind: here {:?}, kept {:?}", local.kind, out.kind));
        }
        if (local.flags ^ out.flags) & !known_later != 0 {
            found.push(format!("flags: here {}, kept {}, not compared {}", bits(local.flags as u32, &FUNC_FLAGS), bits(out.flags as u32, &FUNC_FLAGS), bits(known_later as u32, &FUNC_FLAGS)));
        }
        if local.annotated != out.annotated {
            let marks = |annotated: &[bool]| annotated.iter().map(|&is_annotated| if is_annotated { '1' } else { '0' }).collect::<String>();
            found.push(format!("annotated parameters: here [{}], kept [{}]", marks(&local.annotated), marks(&out.annotated)));
        }
        if local.params.len() != out.params.len() {
            found.push(format!("number of parameters: here {}, kept {}", local.params.len(), out.params.len()));
        }
        if local.captures.len() != out.captures.len() {
            found.push(format!("number of captures: here {}, kept {}", local.captures.len(), out.captures.len()));
        }
        for (i, (&capture, &same)) in local.captures.iter().zip(&out.captures).enumerate() {
            found.extend(self.difference_of_tys(kept, &format!("capture {i}: type"), capture, same));
        }
        found.extend(self.difference_of_tys(kept, "type of `this`", local.this_declared, out.this_declared));
        found.extend(self.difference_of_tys(kept, "type of the result", local.result, out.result));
        for (i, (&param, &same)) in local.params.iter().zip(&out.params).enumerate() {
            found.extend(self.difference_of_tys(kept, &format!("parameter {i}: type"), param, same));
        }
        found
    }
}

/// Who has the last word, and who differs.
fn parties(kept: &Kept<'_>, at: At, why_kept: &str, number: usize, is_declaring_file: bool) -> String {
    format!("kept: {} ({why_kept}); differs: {}, which is the declaring file: {}", kept.about[at.fragment as usize], kept.about[number], yes_or_no(is_declaring_file))
}

/// The first of them in full, and how many there are of each sort.
fn summed_up(mut found: Vec<String>) -> Vec<String> {
    let sorts = ["flags", "names differ", "declared type", "only_function", "literals"];
    let of_fields: Vec<String> = sorts.iter().map(|sort| format!("{sort} {}", found.iter().filter(|line| line.starts_with("field ") && line.contains(sort)).count())).collect();
    let all = found.len();
    found.truncate(MOST_DIFFERENCES);
    let mut lines: Vec<String> = found.into_iter().enumerate().map(|(i, line)| format!("difference {}: {line}", i + 1)).collect();
    lines.push(format!("{all} differences in all; of fields: {}", of_fields.join(", ")));
    lines
}

pub(super) fn of_layout(finder: &mut Finder<'_>, kept: &Kept<'_>, number: usize, shape: &Shape, local: &Layout, id: LayoutId) -> Vec<String> {
    let at = kept.layouts[id.idx()];
    let keeper = &kept.fragments[at.fragment as usize];
    let why_kept = match shape.key.file() {
        Some(file) if file == keeper.file => "the declaring file",
        _ if keeper.file == NO_FILE => "nobody else defines it",
        None if !finder.all.program.layouts[id.idx()].methods.is_empty() => "it lists the accessors of a literal",
        _ => "the first in program order",
    };
    let mut lines = vec![format!("the layout {:x?} (in hexadecimal, as in the problem), number {} in the program", shape.key, id.0), parties(kept, at, why_kept, number, shape.key.file() == Some(finder.fragment.file))];
    lines.extend(summed_up(finder.differences_of_layouts(kept, local, id)));
    lines
}

pub(super) fn of_func(finder: &mut Finder<'_>, kept: &Kept<'_>, number: usize, function: &Function, local: &Func, id: FuncId) -> Vec<String> {
    let (at, has_body) = kept.funcs[id.idx() - kept.entries];
    let why_kept = if has_body { "it has the body, which is reached" } else { "it is a stub: the body is not reached, or nobody has it" };
    let mut lines = vec![format!("the function {:?}, number {} in the program", function.key, id.0), parties(kept, at, why_kept, number, function.key.file() == finder.fragment.file)];
    if let FuncKey::Function(file, func) = function.key {
        lines.push((kept.about_function)(file, func));
    }
    lines.extend(summed_up(finder.differences_of_funcs(kept, local, id)));
    lines
}

pub(super) fn of_variable(finder: &mut Finder<'_>, kept: &Kept<'_>, number: usize, variable: &Variable, id: crate::id::GlobalId) -> Vec<String> {
    let at = kept.globals[id.idx()];
    let out = &finder.all.program.globals[id.idx()];
    let why_kept = if variable.key.file().is_some() { "the declaring file" } else { "the first that mentions it" };
    let mut found: Vec<String> = Vec::new();
    if variable.global.initialization != out.initialization {
        found.push(format!("initialization: here {}, kept {}", variable.global.initialization as u32, out.initialization as u32));
    }
    found.extend(finder.difference_of_tys(kept, "declared type", variable.global.declared, out.declared));
    found.extend(finder.difference_of_only_functions("the variable", (variable.global.only_function, variable.global.only_function_flags), (out.only_function, out.only_function_flags)));
    let mut lines = vec![format!("the variable {}, number {} in the program", text_of_global_key(&variable.key), id.0), parties(kept, at, why_kept, number, variable.key.file() == Some(finder.fragment.file))];
    lines.extend(summed_up(found));
    lines
}

// ───────────────────────────── what nobody defines ─────────────────────────────

fn ty_names_layout(fragment: &Fragment, ty: TyId, layout: LayoutId) -> bool {
    ty.is_some()
        && fragment.tys.get(ty).parts.iter().any(|part| match part {
            Part::Class(named) => *named == layout,
            Part::Global(_, arguments) => arguments.iter().any(|&argument| ty_names_layout(fragment, argument, layout)),
            Part::Array(element) => ty_names_layout(fragment, *element, layout),
        })
}

/// In which ways a function of the fragment mentions the layout.
fn ways_of_function(fragment: &Fragment, function: &Function, layout: LayoutId) -> Vec<&'static str> {
    let names = |ty: TyId| ty_names_layout(fragment, ty, layout);
    let mut ways: Vec<&'static str> = Vec::new();
    let mut add = |is_so: bool, way: &'static str| {
        if is_so && !ways.contains(&way) {
            ways.push(way);
        }
    };
    if let Some(func) = &function.func {
        add(func.captures.iter().any(|&capture| names(capture)), "type: of a capture");
        add(names(func.this_declared), "type: of `this`");
        add(names(func.result), "type: of the result");
        add(func.params.iter().any(|&param| names(param)), "type: of a parameter");
        for value in &func.values {
            add(names(value.ty), "type: of a value");
            add(matches!(value.prediction, Prediction::Ty(expected) | Prediction::Field(expected) if names(expected)), "type: a prediction");
            let Def::Op(op) = &value.def else { continue };
            match op {
                Op::New(made) | Op::NewWith { layout: made, .. } => add(*made == layout, "code: an allocation"),
                Op::IsInstance { layout: of, .. } => add(*of == layout, "code: `instanceof`"),
                Op::FieldGet { layout: of, .. } | Op::FieldSet { layout: of, .. } => add(*of == layout, "code: an access to a field by its index"),
                Op::Coerce { to, .. } => add(names(*to), "type: the target of a cast"),
                _ => {}
            }
        }
    }
    if let Some(body) = &function.body {
        add(body.class == layout, "code: it is a function of the class");
        add(body.declares.contains(&layout), "code: it evaluates the declaration");
        add(body.classes_as_values.contains(&layout), "code: the class object as a value");
        add(body.mentions.globals.iter().any(|global| names(fragment.globals[global.idx()].global.declared)), "type: of a variable it mentions");
    }
    ways
}

/// The same for the definition of a layout.
fn ways_of_layout(fragment: &Fragment, shape: &Shape, layout: LayoutId) -> Vec<&'static str> {
    let Some(definition) = &shape.definition else { return Vec::new() };
    let mut ways: Vec<&'static str> = Vec::new();
    for (is_so, way) in [
        (definition.layout.base == layout, "code: `extends`, it is the base"),
        (definition.constructs == layout, "code: `extends`, it is constructed by its value"),
        (definition.layout.environment == layout, "type: the environment of the class"),
        (definition.layout.fields.iter().any(|field| ty_names_layout(fragment, field.declared, layout)), "type: of a field"),
    ] {
        if is_so {
            ways.push(way);
        }
    }
    ways
}

/// `at`: the shape that names the layout, which no fragment defines. `by`: what was gone through when it was come by.
pub(super) fn of_undefined_layout(checked: &Checked<'_>, fragments: &[Fragment], index: &Index, reach: &Reach, at: At, by: By) -> Vec<String> {
    let naming = &fragments[at.fragment as usize];
    let (shape, layout) = (&naming.layouts[at.index as usize], LayoutId::new(at.index as usize));
    let mut lines = vec![format!("the layout {:x?} (in hexadecimal, as in the problem), which no fragment defines", shape.key)];
    let (mentioning, ways) = match by {
        By::Entry => ("the entry point".to_owned(), Vec::new()),
        By::Func(by) if by.fragment == at.fragment => (format!("the function {:?}", naming.funcs[by.index as usize].key), ways_of_function(naming, &naming.funcs[by.index as usize], layout)),
        By::Layout(by) if by.fragment == at.fragment => (format!("the layout {:x?}", naming.layouts[by.index as usize].key), ways_of_layout(naming, &naming.layouts[by.index as usize], layout)),
        By::Func(by) => (format!("the function {:?}", fragments[by.fragment as usize].funcs[by.index as usize].key), vec!["type: of a variable that another fragment declares"]),
        By::Layout(by) => (format!("the layout {:x?}", fragments[by.fragment as usize].layouts[by.index as usize].key), vec!["type: of what another fragment declares"]),
    };
    lines.push(format!("mentioned by {mentioning}, in {}; ways: {}", about_fragment(checked, index, reach, naming), if ways.is_empty() { "none found".to_owned() } else { ways.join(", ") }));
    let LayoutKey::Instance(file, class) = shape.key else { return lines };
    let (hir, bound) = (checked.files.hir(file), checked.files.bound(file));
    let declared = &hir[class];
    let symbol = bound.class_symbol[class.idx()];
    let about_symbol = if symbol.is_none() {
        "none".to_owned()
    } else {
        let symbol = checked.files.sym(file, symbol);
        let flags = checked.files.flags(symbol);
        let set: Vec<&str> = SYMBOL_FLAGS.iter().filter(|flag| flags.contains(flag.0)).map(|flag| flag.1).collect();
        format!("{} with {} declarations", set.join(" "), checked.files.decls(symbol).len())
    };
    lines.push(format!(
        "the class: a class {}; `declare`: {}; abstract: {}; type parameters: {}; `extends`: {}; `implements`: {}; members: {}; evaluated at most once: {}; symbol: {about_symbol}",
        match bound.class_owner[class.idx()] {
            ClassOwner::Expr(_) => "expression",
            ClassOwner::Stmt(_) => "declaration",
        },
        yes_or_no(declared.flags.contains(Flags::AMBIENT)),
        yes_or_no(declared.flags.contains(Flags::ABSTRACT)),
        declared.type_params.len(),
        yes_or_no(declared.extends.is_some()),
        declared.implements.len(),
        declared.members.len(),
        yes_or_no(checked.checker().is_evaluated_once(file, bound.class_owner[class.idx()].to_parent())),
    ));
    let place = match place_of_error(fragments, index, reach, (file, declared.start), &mut |_| false) {
        None => "code that is in the program",
        Some(Elsewhere::Cut(_)) => "code that a constant has cut",
        Some(Elsewhere::DroppedImport) => "an import that is dropped",
        Some(Elsewhere::NotReached(_)) => "a function or a module that is not reached",
        Some(Elsewhere::NoModule) => "a file that has no fragment",
    };
    let own = index.by_file.get(&file).map(|&number| &fragments[number as usize]);
    let in_its_own = match own.map(|own| own.layouts.iter().find(|other| other.key == shape.key)) {
        None => "there is none",
        Some(None) => "does not mention the layout",
        Some(Some(other)) if other.definition.is_none() => "only names the layout",
        Some(Some(_)) => "defines the layout",
    };
    let defined = own.map_or(0, |own| own.layouts.iter().filter(|other| matches!(other.key, LayoutKey::Instance(of, _) if of == file) && other.definition.is_some()).count());
    lines.push(format!("its {}; the declaration lies in {place}; the fragment of its file: {in_its_own}; that defines {defined} of the {} classes of the file", about_file(checked, index, reach, file), hir.classes.len()));
    lines
}
