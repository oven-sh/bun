//! Sound types: the parser half. See `bun_ast::sound_types` for the model.
//!
//! The parse pass records annotations (`G::Arg::sound_type`,
//! `G::Property::sound_type`, `Symbol::sound_type`) or wraps the annotated
//! expression in `E::TypeCheck`. The visit pass resolves them and emits
//! `$$t(value, mask)`, an ordinary call of an unbound identifier, so every
//! later pass treats a check as a call it knows nothing about.

use bun_alloc::ArenaVecExt as _;
use bun_collections::{HashMap, VecExt};

use crate::p::P;
use crate::parser::{ExprIn, Ref};
use bun_ast as js_ast;
use bun_ast::sound_types::{
    Mask,
    CHECK_FN_NAME, DeclKind, Level, Located, ModuleTypes, NameId, Resolver, Rule, SoundType, mask,
};
use bun_ast::{B, E, Expr, ExprData, ExprNodeList, G, Op, S, Stmt, StmtData, flags};

#[derive(Clone, Copy)]
enum FieldKey<'a> {
    Name(&'a [u8]),
    Private(Ref),
}

impl FieldKey<'_> {
    fn eql(&self, other: &FieldKey<'_>) -> bool {
        match (self, other) {
            (FieldKey::Name(a), FieldKey::Name(b)) => a == b,
            (FieldKey::Private(a), FieldKey::Private(b)) => a.eql(*b),
            _ => false,
        }
    }
}

/// The annotated instance fields of a class being visited.
#[derive(Default)]
struct ClassFields<'a> {
    fields: Vec<(FieldKey<'a>, Mask)>,
    /// What `this` is in its instance methods. Only at `Level::Infer`.
    instance: SoundType,
}

pub struct SoundTypesState<'a> {
    pub(crate) types: ModuleTypes,
    resolver: Resolver<'a>,
    /// The unbound `$$t` symbol, once a check has been emitted.
    check_ref: Ref,
    /// Symbol index of a function declaration or a `const` bound to a function
    /// literal -> its return annotation. Only filled at `Level::Full`.
    fn_returns: HashMap<u32, SoundType>,
    /// Symbol index of a variable without an annotation -> what TypeScript
    /// infers for it from its initializer. Only filled at `Level::Infer`.
    inferred: HashMap<u32, Located>,
    /// The return annotation of the function or arrow that finished parsing last.
    pub(crate) last_fn_return: SoundType,
    /// Out-parameter of `skip_type_script_arrow_return_type_with_backtracking`.
    pub(crate) arrow_return: SoundType,
    /// Non-zero inside `declare global { }`.
    pub(crate) foreign_declaration_depth: u32,
    /// The items of the import or export clause parsed last, type-only ones included.
    clause: Vec<(&'a [u8], &'a [u8])>,
    classes: Vec<ClassFields<'a>>,
    /// 1 + index into `classes` for the method `visit_func` is about to visit.
    next_fn_this_class: u32,
    counts: Vec<(Rule, Mask)>,
    /// EXPERIMENT: see `bun_ast::sound_types::oracle`.
    oracle: Option<bun_ast::sound_types::oracle::Entries>,
    /// `BUN_SOUND_TYPES_ORACLE_FOR=iteration`: it is only asked what a `for`-`of` goes through,
    /// where a check follows that is worth its size.
    oracle_is_for_iteration_only: bool,
    is_marking_iteration: bool,
}

impl<'a> SoundTypesState<'a> {
    pub(crate) fn new(
        path: &[u8],
        contents: &[u8],
        host: Option<&'a dyn bun_ast::sound_types::ModuleTypesHost>,
    ) -> Box<Self> {
        Box::new(SoundTypesState {
            types: ModuleTypes::new(path),
            resolver: Resolver::new(host),
            check_ref: Ref::NONE,
            fn_returns: HashMap::default(),
            inferred: HashMap::default(),
            last_fn_return: SoundType::TOP,
            arrow_return: SoundType::TOP,
            foreign_declaration_depth: 0,
            clause: Vec::new(),
            classes: Vec::new(),
            next_fn_this_class: 0,
            counts: Vec::new(),
            oracle: bun_ast::sound_types::oracle::entries_for(path, contents),
            oracle_is_for_iteration_only: std::env::var_os("BUN_SOUND_TYPES_ORACLE_FOR")
                .is_some_and(|v| v == "iteration"),
            is_marking_iteration: false,
        })
    }
}

/// What the TypeScript module `text` at `path` declares in the type namespace.
pub fn module_types_of_text(
    path: &[u8],
    text: &[u8],
    loader: bun_ast::Loader,
) -> Option<ModuleTypes> {
    debug_assert!(loader.is_typescript());
    let arena = bun_alloc::Arena::new();
    let mut ast_memory_allocator = bun_ast::ASTMemoryAllocator::borrowing(&arena);
    let _ast_scope = ast_memory_allocator.enter();
    let source = bun_ast::Source::init_path_string(path, text);
    let mut options = crate::ParserOptions::init(Default::default(), loader);
    options.features.no_macros = true;
    options.features.top_level_await = true;
    options.features.sound_types = Level::Basic;
    options.suppress_warnings_about_weird_code = true;
    let define = crate::Define::default();
    let mut log = bun_ast::Log::init();
    crate::Parser::init(options, &mut log, &source, &define, &arena)
        .ok()?
        .parse_module_types()
        .ok()
        .flatten()
}

const STATIC_MASK_MAX_DEPTH: u32 = 8;

/// What `<string>.<name>(...)` returns.
fn string_method_mask(name: &[u8]) -> Mask {
    match name {
        b"charCodeAt" | b"indexOf" | b"lastIndexOf" | b"localeCompare" | b"search" => mask::NUMBER,
        b"codePointAt" => mask::NUMBER | mask::UNDEFINED,
        b"at" => mask::STRING | mask::UNDEFINED,
        b"charAt" | b"concat" | b"normalize" | b"padEnd" | b"padStart" | b"repeat" | b"replace"
        | b"replaceAll" | b"slice" | b"substring" | b"substr" | b"toLowerCase"
        | b"toUpperCase" | b"toLocaleLowerCase" | b"toLocaleUpperCase" | b"trim" | b"trimEnd"
        | b"trimStart" | b"toString" | b"valueOf" => mask::STRING,
        b"endsWith" | b"includes" | b"startsWith" | b"isWellFormed" => mask::BOOLEAN,
        b"split" => mask::ARRAY,
        _ => mask::TOP,
    }
}

impl<'a, const TYPESCRIPT: bool, const SCAN_ONLY: bool> P<'a, TYPESCRIPT, SCAN_ONLY> {
    #[inline(always)]
    pub(crate) fn sound_types_enabled(&self) -> bool {
        TYPESCRIPT && self.sound_level != Level::Off
    }

    #[inline(always)]
    pub(crate) fn sound_types_full(&self) -> bool {
        TYPESCRIPT && self.sound_level >= Level::Full
    }

    #[inline(always)]
    pub(crate) fn sound_types_infer(&self) -> bool {
        TYPESCRIPT && self.sound_level >= Level::Infer
    }

    #[inline]
    pub(crate) fn sound(&mut self) -> &mut SoundTypesState<'a> {
        self.sound_state
            .as_deref_mut()
            .expect("sound types are enabled")
    }

    // ───────────────────────────── parse pass ─────────────────────────────

    /// `value` annotated with `ty`, to be resolved by the visit pass.
    pub(crate) fn sound_annotate(&mut self, value: Expr, ty: SoundType, rule: Rule) -> Expr {
        // A cast to `any` is kept: see `sound_is_escape_hatch`.
        if ty == SoundType::TOP || (ty == SoundType::ANY && rule != Rule::Cast) {
            return value;
        }
        self.new_expr(E::TypeCheck { value, ty, rule }, value.loc)
    }

    /// `e` for a position whose meaning depends on the shape of the operand:
    /// `(a.b as F)()` calls `a.b` with `a` as the receiver, `delete (a.b as T)`
    /// deletes a property, `typeof (a as T)` does not throw when `a` is unbound.
    #[inline]
    pub(crate) fn sound_without_annotations(mut e: Expr) -> Expr {
        if TYPESCRIPT {
            while let ExprData::ETypeCheck(check) = e.data {
                e = check.value;
            }
        }
        e
    }

    /// A `type`, `interface`, `class` or `enum` declaration in the current scope.
    pub(crate) fn sound_declare_type(
        &mut self,
        name: &[u8],
        kind: DeclKind,
        ty: SoundType,
        is_export: bool,
    ) {
        let is_at_module_scope = self.current_scope == self.module_scope;
        self.sound_declare_type_in(is_at_module_scope, name, kind, ty, is_export);
    }

    pub(crate) fn sound_declare_type_in(
        &mut self,
        is_at_module_scope: bool,
        name: &[u8],
        kind: DeclKind,
        ty: SoundType,
        is_export: bool,
    ) {
        let state = self.sound();
        if !is_at_module_scope || state.foreign_declaration_depth > 0 {
            state.types.declare_opaque(name);
            return;
        }
        state.types.declare(name, kind, ty);
        if is_export {
            state.types.export_local(name, name);
        }
    }

    /// A class statement in the current scope. `name` is empty for
    /// `export default class {}`.
    pub(crate) fn sound_declare_class(&mut self, name: &[u8], class: &G::Class, is_export: bool) {
        if name.is_empty() {
            return;
        }
        let ty = match class.extends.map(|extends| extends.data) {
            None => SoundType::from_mask(mask::OTHER_OBJECT),
            Some(ExprData::EIdentifier(id)) => {
                let base = self.load_name_from_ref(id.ref_);
                let types = &mut self.sound().types;
                let base = types.reference(base, SoundType::TOP);
                types.instance_of_subclass(base)
            }
            Some(_) => SoundType::from_mask(mask::OBJECT),
        };
        let members = self.sound_class_members(class);
        let ty = self.sound().types.object(ty, members);
        self.sound_declare_type(name, DeclKind::Class, ty, is_export);
    }

    /// The declared types of the instance properties of `class`.
    fn sound_class_members(&mut self, class: &G::Class) -> Vec<(NameId, SoundType)> {
        let mut members: Vec<(NameId, SoundType)> = Vec::new();
        for property in class.properties.slice() {
            if property.flags.contains(flags::Property::IsStatic)
                || property.flags.contains(flags::Property::IsComputed)
            {
                continue;
            }
            let Some(ExprData::EString(key)) = property.key.map(|key| key.data) else {
                continue;
            };
            if !key.is_utf8() {
                continue;
            }
            if key.data.slice() == b"constructor"
                && let Some(ExprData::EFunction(ctor)) = property.value.map(|v| v.data)
            {
                for arg in ctor.func.args.slice() {
                    if arg.is_typescript_ctor_field
                        && !arg.sound_type.is_top()
                        && let B::B::BIdentifier(id) = arg.binding.data
                    {
                        let name = self.load_name_from_ref(id.r#ref);
                        let name = self.sound().types.intern(name);
                        members.push((name, arg.sound_type));
                    }
                }
                continue;
            }
            if property.sound_type.is_top() {
                continue;
            }
            let name = self.sound().types.intern(key.data.slice());
            // A getter and a setter, or overloads: the first one that says something.
            if !members.iter().any(|(member, _)| *member == name) {
                members.push((name, property.sound_type));
            }
        }
        members
    }

    /// `<kind> <binding>: <ty> = <init>`
    pub(crate) fn sound_annotate_initializer(
        &mut self,
        kind: js_ast::symbol::Kind,
        binding: &js_ast::Binding,
        init: Expr,
        ty: SoundType,
    ) -> Expr {
        if self.sound_types_full()
            && kind == js_ast::symbol::Kind::Constant
            && matches!(init.data, ExprData::EArrow(_) | ExprData::EFunction(_))
            && let B::B::BIdentifier(id) = binding.data
        {
            let returns = self.sound().last_fn_return;
            self.sound_record_fn_return(id.r#ref, returns);
        }
        if ty.is_top() || self.sound_is_escape_hatch(&init) {
            return init;
        }
        self.sound_record_variable(binding, ty);
        self.sound_annotate(init, ty, Rule::VarInit)
    }

    pub(crate) fn sound_enum_type(values: &[js_ast::EnumValue]) -> SoundType {
        let mut m: Mask = 0;
        for value in values {
            m |= match value.value.map(|v| v.data) {
                None | Some(ExprData::ENumber(_)) => mask::NUMBER,
                Some(ExprData::EString(_)) => mask::STRING,
                Some(_) => mask::NUMBER | mask::STRING,
            };
        }
        SoundType::from_mask(if m == 0 { mask::NUMBER } else { m })
    }

    /// `let name: ty = <initializer>`
    pub(crate) fn sound_record_variable(&mut self, binding: &js_ast::Binding, ty: SoundType) {
        let B::B::BIdentifier(id) = binding.data else {
            return;
        };
        if !id.r#ref.is_symbol() {
            return;
        }
        let slot = &mut self.symbols[id.r#ref.inner_index() as usize].sound_type;
        // A redeclared `var`. `ANY` keeps later declarations from reviving it.
        *slot = if *slot == SoundType::TOP || *slot == ty {
            ty
        } else {
            SoundType::ANY
        };
    }

    /// A parameter that has been declared and whose default has been parsed.
    pub(crate) fn sound_record_parameter(&mut self, arg: &G::Arg) {
        if arg.sound_type.is_top()
            || arg
                .default
                .is_some_and(|default| self.sound_is_escape_hatch(&default))
        {
            return;
        }
        self.sound_record_variable(&arg.binding, arg.sound_type);
    }

    // ── Imports and exports ──────────────────────────────────────────────

    #[inline]
    fn sound_is_declaring_for_this_module(&mut self) -> bool {
        self.current_scope == self.module_scope && self.sound().foreign_declaration_depth == 0
    }

    /// `{ outer as inner }` of the import or export clause being parsed.
    /// `outer` is the name the other module sees.
    pub(crate) fn sound_clause_item(&mut self, outer: &'a [u8], inner: &'a [u8]) {
        self.sound().clause.push((outer, inner));
    }

    pub(crate) fn sound_clause_items(&mut self, items: &[js_ast::ClauseItem]) {
        for item in items {
            self.sound()
                .clause
                .push((item.alias.slice(), item.original_name.slice()));
        }
    }

    /// `import default_name, * as star_name, { <clause> } from path`
    pub(crate) fn sound_declare_imports(
        &mut self,
        path: &[u8],
        default_name: Option<&[u8]>,
        star_name: Option<&[u8]>,
    ) {
        let for_this_module = self.sound_is_declaring_for_this_module();
        let state = self.sound();
        let clause = core::mem::take(&mut state.clause);
        if !for_this_module {
            for name in clause
                .iter()
                .map(|(_, local)| *local)
                .chain(default_name)
                .chain(star_name)
            {
                state.types.declare_opaque(name);
            }
            return;
        }
        for (imported, local) in clause {
            state.types.declare_import_item(local, path, imported);
        }
        if let Some(local) = default_name {
            state.types.declare_import_item(local, path, b"default");
        }
        if let Some(local) = star_name {
            state.types.declare_import_star(local, path);
        }
    }

    /// `export { <clause> }` or `export { <clause> } from path`
    pub(crate) fn sound_declare_exports(&mut self, path: Option<&[u8]>) {
        let for_this_module = self.sound_is_declaring_for_this_module();
        let state = self.sound();
        let clause = core::mem::take(&mut state.clause);
        if !for_this_module {
            return;
        }
        for (exported, inner) in clause {
            match path {
                Some(path) => state.types.export_from(exported, path, inner),
                None => state.types.export_local(exported, inner),
            }
        }
    }

    /// `export * from path` or `export * as alias from path`
    pub(crate) fn sound_declare_export_star(&mut self, path: &[u8], alias: Option<&[u8]>) {
        if !self.sound_is_declaring_for_this_module() {
            return;
        }
        let types = &mut self.sound().types;
        match alias {
            Some(alias) => types.export_star_as(alias),
            None => types.export_star(path),
        }
    }

    /// `export { local as exported }`, where `local` may be a class or a type.
    pub(crate) fn sound_declare_export(&mut self, exported: &[u8], local: &[u8]) {
        if self.sound_is_declaring_for_this_module() {
            self.sound().types.export_local(exported, local);
        }
    }

    /// `ref_` always holds the function whose return annotation is `ty`.
    pub(crate) fn sound_record_fn_return(&mut self, ref_: Ref, ty: SoundType) {
        if !ref_.is_symbol() {
            return;
        }
        let returns = &mut self.sound().fn_returns;
        let ty = match returns.get(&ref_.inner_index()) {
            Some(prev) if *prev != ty => SoundType::TOP,
            _ => ty,
        };
        returns.insert(ref_.inner_index(), ty);
    }

    pub(crate) fn sound_forget_symbols_from(&mut self, symbols_len: usize) {
        if let Some(state) = self.sound_state.as_deref_mut() {
            let stale: Vec<u32> = state
                .fn_returns
                .keys()
                .filter(|index| **index as usize >= symbols_len)
                .copied()
                .collect();
            for index in stale {
                state.fn_returns.remove(&index);
            }
        }
    }

    /// Between the parse pass and the visit pass.
    pub(crate) fn sound_finish_parse_pass(&mut self) {
        let module_scope = self.module_scope;
        let symbols = &self.symbols;
        self.sound_state
            .as_deref_mut()
            .expect("sound types are enabled")
            .types
            .finish(|name| {
                // `emitDecoratorMetadata` binds the type names it refers to.
                module_scope.members.get(name).is_some_and(|member| {
                    symbols[member.ref_.inner_index() as usize].kind
                        != js_ast::symbol::Kind::Unbound
                })
            });
    }

    // ───────────────────────────── visit pass ─────────────────────────────

    #[inline]
    pub(crate) fn sound_resolve(&mut self, ty: SoundType) -> Mask {
        if let Some(m) = ty.as_mask() {
            return m;
        }
        let state = self.sound();
        state.resolver.resolve(&state.types, ty)
    }

    /// An unvisited expression whose author opted out of type checking:
    /// `e as any`, `e as unknown as T`, `null!`, `undefined!`.
    pub(crate) fn sound_is_escape_hatch(&self, expr: &Expr) -> bool {
        let ExprData::ETypeCheck(check) = expr.data else {
            return false;
        };
        match check.rule {
            Rule::Cast => check.ty == SoundType::ANY || self.sound_is_escape_hatch(&check.value),
            Rule::NonNull => match check.value.data {
                ExprData::ENull(_) | ExprData::EUndefined(_) => true,
                ExprData::EIdentifier(id) => self.load_name_from_ref(id.ref_) == b"undefined",
                _ => false,
            },
            _ => false,
        }
    }

    /// The tags a visited expression can evaluate to, as far as its syntax tells.
    fn sound_static_mask(&mut self, expr: &Expr, depth: u32) -> Mask {
        if depth >= STATIC_MASK_MAX_DEPTH {
            return mask::TOP;
        }
        const NUMERIC: Mask = mask::NUMBER | mask::BIGINT;
        match expr.data {
            ExprData::ENumber(_) => mask::NUMBER,
            ExprData::EString(_) => mask::STRING,
            ExprData::ETemplate(t) if t.tag.is_none() => mask::STRING,
            ExprData::EBoolean(_) | ExprData::EBranchBoolean(_) => mask::BOOLEAN,
            ExprData::ENull(_) => mask::NULL,
            ExprData::EUndefined(_) => mask::UNDEFINED,
            ExprData::EBigInt(_) => mask::BIGINT,
            ExprData::EArray(_) => mask::ARRAY,
            ExprData::EObject(_) | ExprData::ERegExp(_) => mask::PLAIN_OBJECT,
            ExprData::EFunction(_) | ExprData::EArrow(_) | ExprData::EClass(_) => mask::FUNCTION,
            ExprData::ENew(_) => mask::OBJECT,
            ExprData::EInlinedEnum(e) => self.sound_static_mask(&e.value, depth + 1),
            ExprData::EUnary(e) => match e.op {
                Op::Code::UnNot | Op::Code::UnDelete => mask::BOOLEAN,
                Op::Code::UnTypeof => mask::STRING,
                Op::Code::UnVoid => mask::UNDEFINED,
                Op::Code::UnPos => mask::NUMBER,
                _ => NUMERIC,
            },
            ExprData::EBinary(e) => match e.op {
                Op::Code::BinLt
                | Op::Code::BinLe
                | Op::Code::BinGt
                | Op::Code::BinGe
                | Op::Code::BinIn
                | Op::Code::BinInstanceof
                | Op::Code::BinLooseEq
                | Op::Code::BinLooseNe
                | Op::Code::BinStrictEq
                | Op::Code::BinStrictNe => mask::BOOLEAN,
                Op::Code::BinSub
                | Op::Code::BinMul
                | Op::Code::BinDiv
                | Op::Code::BinRem
                | Op::Code::BinPow
                | Op::Code::BinShl
                | Op::Code::BinShr
                | Op::Code::BinBitwiseOr
                | Op::Code::BinBitwiseAnd
                | Op::Code::BinBitwiseXor => NUMERIC,
                Op::Code::BinUShr => mask::NUMBER,
                Op::Code::BinAdd => {
                    let left = self.sound_static_mask(&e.left, depth + 1);
                    let right = self.sound_static_mask(&e.right, depth + 1);
                    if left == mask::STRING || right == mask::STRING {
                        mask::STRING
                    } else if left == mask::NUMBER && right == mask::NUMBER {
                        mask::NUMBER
                    } else {
                        NUMERIC | mask::STRING
                    }
                }
                Op::Code::BinComma | Op::Code::BinAssign => {
                    self.sound_static_mask(&e.right, depth + 1)
                }
                Op::Code::BinLogicalOr | Op::Code::BinLogicalAnd => {
                    self.sound_static_mask(&e.left, depth + 1)
                        | self.sound_static_mask(&e.right, depth + 1)
                }
                Op::Code::BinNullishCoalescing => {
                    (self.sound_static_mask(&e.left, depth + 1) & mask::NON_NULLISH)
                        | self.sound_static_mask(&e.right, depth + 1)
                }
                _ => mask::TOP,
            },
            ExprData::EIf(e) => {
                self.sound_static_mask(&e.yes, depth + 1) | self.sound_static_mask(&e.no, depth + 1)
            }
            ExprData::ECall(call) => self.sound_mask_of_check(&call).unwrap_or(mask::TOP),
            // The initializer of an annotated `const` was checked, and nothing else stores to it.
            ExprData::EIdentifier(id) => {
                let symbol = &self.symbols[id.ref_.inner_index() as usize];
                if symbol.kind == js_ast::symbol::Kind::Constant {
                    let ty = symbol.sound_type;
                    self.sound_resolve(ty)
                } else {
                    mask::TOP
                }
            }
            _ => mask::TOP,
        }
    }

    /// `Some(mask)` when `call` is `$$t(value, mask)`.
    fn sound_mask_of_check(&mut self, call: &E::Call) -> Option<Mask> {
        let ExprData::EIdentifier(target) = call.target.data else {
            return None;
        };
        let check_ref = self.sound().check_ref;
        if !check_ref.is_valid() || !target.ref_.eql(check_ref) || call.args.len_u32() != 2 {
            return None;
        }
        match call.args.at(1).data {
            ExprData::ENumber(n) => Some(mask::from_wire(n.value() as u32)),
            _ => None,
        }
    }

    /// `$$t(value, mask)`, or `value` when the check cannot fail or cannot be
    /// expressed. `value` has been visited.
    pub(crate) fn sound_check(&mut self, value: Expr, m: Mask, rule: Rule) -> Expr {
        self.sound_check_impl(value, m, rule, false)
    }

    /// `for (x of value)`. If the type of `value` is an array, wraps it in a check that the engine
    /// recognizes, so that it iterates by index. (The check is kept even where it is known to
    /// pass: it is the marker that the engine looks for, and is free where the engine knows too.)
    pub(crate) fn sound_mark_iterated_array(&mut self, value: Expr) -> Expr {
        self.sound().is_marking_iteration = true;
        let t = self.sound_infer(&value, 0);
        self.sound().is_marking_iteration = false;
        if self.sound_mask_of(t) != mask::ARRAY {
            return value;
        }
        self.sound_check_impl(value, mask::ARRAY, Rule::Iterated, true)
    }

    fn sound_check_impl(&mut self, value: Expr, m: Mask, rule: Rule, even_if_known: bool) -> Expr {
        debug_assert!(m != 0);
        if m >= mask::TOP || self.is_revisit_for_substitution {
            return value;
        }
        match value.data {
            // The bundler tracks where these flow by their position.
            ExprData::ERequireString(_)
            | ExprData::ERequireResolveString(_)
            | ExprData::EImport(_)
            | ExprData::EMissing(_)
            | ExprData::ESpread(_) => return value,
            ExprData::EAwait(a) if matches!(a.value.data, ExprData::EImport(_)) => return value,
            _ => {}
        }
        if !even_if_known && self.sound_static_mask(&value, 0) & !m == 0 {
            return value;
        }
        // One check does for two.
        let (value, m) = match value.data {
            ExprData::ECall(inner) => match self.sound_mask_of_check(&inner) {
                Some(inner_mask) if inner_mask & m != 0 => (*inner.args.at(0), inner_mask & m),
                _ => (value, m),
            },
            _ => (value, m),
        };

        let Some(wire) = mask::to_wire(m) else {
            return value;
        };

        let loc = value.loc;
        let check_ref = self.sound().check_ref;
        let check_ref = if check_ref.is_valid() {
            self.record_usage_impl(check_ref, false);
            check_ref
        } else {
            let found = self
                .find_symbol(loc, CHECK_FN_NAME)
                .expect("unreachable")
                .r#ref;
            self.sound().check_ref = found;
            found
        };
        self.sound().counts.push((rule, m));
        let target = self.new_expr(E::Identifier::init(check_ref), loc);
        let mask_arg = self.new_expr(E::Number::new(f64::from(wire)), loc);
        self.new_expr(
            E::Call {
                target,
                args: ExprNodeList::from_arena_slice(&[value, mask_arg]),
                close_paren_loc: loc,
                ..Default::default()
            },
            loc,
        )
    }

    pub(crate) fn sound_visit_type_check(&mut self, e: &mut Expr, in_: ExprIn) {
        let ExprData::ETypeCheck(check) = e.data else {
            unreachable!()
        };
        let (value, ty, rule) = (check.value, check.ty, check.rule);
        let is_escape_hatch = self.sound_is_escape_hatch(e);
        *e = value;

        if rule == Rule::Param {
            // Made by `sound_param_checks`: `value` already names the symbol.
            let ExprData::EIdentifier(id) = value.data else {
                unreachable!()
            };
            self.record_usage(id.ref_);
            let m = self.sound_resolve(ty);
            *e = self.sound_check(value, m, rule);
            return;
        }

        let m = if in_.assign_target != js_ast::AssignTarget::None
            || (rule == Rule::NonNull && !self.sound_types_full())
            || is_escape_hatch
            || self.sound_is_escape_hatch(&value)
        {
            mask::TOP
        } else {
            self.sound_resolve(ty)
        };
        if m == mask::TOP {
            self.visit_expr_in_out(e, in_);
            return;
        }
        self.visit_expr_in_out(
            e,
            ExprIn {
                is_immediately_assigned_to_decl: in_.is_immediately_assigned_to_decl,
                ..Default::default()
            },
        );
        // `e!` has the type of `e`, without null and undefined.
        let m = if rule == Rule::NonNull && self.sound_types_infer() {
            let t = self.sound_infer(e, 0);
            match self.sound_mask_of(t) & m {
                0 => m,
                narrowed => narrowed,
            }
        } else {
            m
        };
        *e = self.sound_check(*e, m, rule);
    }

    /// How many leading statements of a visited function body are its
    /// directives and parameter checks.
    pub(crate) fn sound_prologue_len(&mut self, body: &[Stmt]) -> usize {
        body.iter()
            .take_while(|stmt| match stmt.data {
                StmtData::SDirective(_) => true,
                StmtData::SExpr(expr) => match expr.value.data {
                    ExprData::ECall(call) => self.sound_mask_of_check(&call).is_some(),
                    _ => false,
                },
                _ => false,
            })
            .count()
    }

    /// One `E::TypeCheck` per parameter to check on entry. Call before `visit_args`.
    fn sound_param_checks(
        &mut self,
        args: &[G::Arg],
        has_rest_arg: bool,
    ) -> smallvec::SmallVec<[Expr; 4]> {
        let mut checks = smallvec::SmallVec::new();
        let count = args.len() - usize::from(has_rest_arg && !args.is_empty());
        // TEMPORARY-ANNOTATION-STATS
        let stats = bun_ast::sound_types::stats::is_requested();
        let bump = |what: String| {
            if stats {
                bun_ast::sound_types::stats::bump(format!("param {what}"));
            }
        };
        if count != args.len() {
            bump("rest".to_owned());
        }
        for arg in &args[..count] {
            let is_destructured = !matches!(arg.binding.data, B::B::BIdentifier(_));
            if arg.sound_type == SoundType::ANY {
                bump("any or unknown".to_owned());
                continue;
            }
            // EXPERIMENT: see `bun_ast::sound_types::oracle`.
            let from_oracle = if arg.sound_type.is_top() && !is_destructured {
                self.sound_oracle(arg.binding.loc.start)
            } else {
                mask::TOP
            };
            if arg.sound_type.is_top() && from_oracle == mask::TOP {
                bump(format!(
                    "no type at parse (unannotated, or a kind the parser gives up on){}",
                    if is_destructured { ", destructured" } else { "" }
                ));
                continue;
            }
            let B::B::BIdentifier(id) = arg.binding.data else {
                bump("annotated but destructured".to_owned());
                continue;
            };
            if let Some(default) = &arg.default
                && self.sound_is_escape_hatch(default)
            {
                bump("escape hatch".to_owned());
                continue;
            }
            let since = self.sound().resolver.unresolved_len();
            let m = if from_oracle != mask::TOP {
                self.sound()
                    .inferred
                    .insert(id.r#ref.inner_index(), Located::from_mask(from_oracle));
                from_oracle
            } else {
                self.sound_resolve(arg.sound_type)
            };
            if m == mask::TOP {
                bump(format!(
                    "annotated, resolves to anything: {}",
                    self.sound().resolver.last_unresolved_kind(since)
                ));
                continue;
            }
            bump(
                if m & mask::OBJECT == 0 {
                    "checked: primitives only"
                } else if m & !(mask::OBJECT | mask::NULL | mask::UNDEFINED) == 0 {
                    "checked: some kind of object (or nullish)"
                } else {
                    "checked: objects and primitives"
                }
                .to_owned(),
            );
            let loc = arg.binding.loc;
            let value = self.new_expr(E::Identifier::init(id.r#ref), loc);
            checks.push(self.new_expr(
                E::TypeCheck {
                    value,
                    ty: SoundType::from_mask(m),
                    rule: Rule::Param,
                },
                loc,
            ));
        }
        checks
    }

    /// The unvisited body of a function with its parameter checks after the
    /// directive prologue.
    pub(crate) fn sound_body_with_param_checks(
        &mut self,
        args: &[G::Arg],
        has_rest_arg: bool,
        body: &'a [Stmt],
    ) -> &'a [Stmt] {
        let checks = self.sound_param_checks(args, has_rest_arg);
        if checks.is_empty() {
            return body;
        }
        let prologue = body
            .iter()
            .take_while(|stmt| matches!(stmt.data, StmtData::SDirective(_)))
            .count();
        let mut stmts =
            bun_alloc::ArenaVec::<Stmt>::with_capacity_in(body.len() + checks.len(), self.arena);
        stmts.extend_from_slice(&body[..prologue]);
        for check in checks {
            stmts.push(self.s(
                S::SExpr {
                    value: check,
                    ..Default::default()
                },
                check.loc,
            ));
        }
        stmts.extend_from_slice(&body[prologue..]);
        stmts.into_bump_slice()
    }

    /// Same for `(a) => expr`, which becomes `(a) => ($$t(a, m), expr)`.
    pub(crate) fn sound_arrow_body_with_param_checks(
        &mut self,
        arrow: &E::Arrow,
    ) -> Option<&'a [Stmt]> {
        let body: &'a [Stmt] = arrow.body.stmts.slice();
        if arrow.prefer_expr
            && let [stmt] = body
            && let StmtData::SReturn(ret) = stmt.data
            && let Some(mut value) = ret.value
        {
            let checks = self.sound_param_checks(arrow.args.slice(), arrow.has_rest_arg);
            if checks.is_empty() {
                return None;
            }
            for check in checks.into_iter().rev() {
                value = self.new_expr(
                    E::Binary {
                        op: Op::Code::BinComma,
                        left: check,
                        right: value,
                    },
                    value.loc,
                );
            }
            let stmt = self.s(S::Return { value: Some(value) }, stmt.loc);
            return Some(self.arena.alloc_slice_copy(&[stmt]));
        }
        let with_checks =
            self.sound_body_with_param_checks(arrow.args.slice(), arrow.has_rest_arg, body);
        if with_checks.len() == body.len() {
            None
        } else {
            Some(with_checks)
        }
    }

    // ── Class fields ─────────────────────────────────────────────────────

    /// Call before visiting the members of `class`; pair with `sound_leave_class`.
    pub(crate) fn sound_enter_class(&mut self, class: &G::Class) {
        let mut fields: Vec<(FieldKey<'a>, Mask)> = Vec::new();
        let mut add = |key: FieldKey<'a>, m: Mask| {
            if let Some(existing) = fields.iter_mut().find(|(k, _)| k.eql(&key)) {
                existing.1 = mask::TOP;
            } else {
                fields.push((key, m));
            }
        };
        for property in class.properties.slice() {
            if property.flags.contains(flags::Property::IsStatic)
                || property.flags.contains(flags::Property::IsComputed)
            {
                continue;
            }
            let Some(key) = property.key else { continue };
            let field_key = match key.data {
                ExprData::EString(s) if s.is_utf8() => FieldKey::Name(s.data.slice()),
                ExprData::EPrivateIdentifier(private) => FieldKey::Private(private.ref_),
                _ => continue,
            };
            let is_field = property.kind == G::PropertyKind::Normal
                && !property.flags.contains(flags::Property::IsMethod)
                && property.value.is_none();
            let m = if !is_field
                || property
                    .initializer
                    .is_some_and(|init| self.sound_is_escape_hatch(&init))
            {
                mask::TOP
            } else {
                self.sound_resolve(property.sound_type)
            };
            add(field_key, m);

            // Parameter properties
            if property.flags.contains(flags::Property::IsMethod)
                && let FieldKey::Name(b"constructor") = field_key
                && let Some(ExprData::EFunction(ctor)) = property.value.map(|v| v.data)
            {
                for arg in ctor.func.args.slice() {
                    if !arg.is_typescript_ctor_field {
                        continue;
                    }
                    let B::B::BIdentifier(id) = arg.binding.data else {
                        continue;
                    };
                    let name: &'a [u8] = self.symbols[id.r#ref.inner_index() as usize]
                        .original_name
                        .slice();
                    let m = if arg
                        .default
                        .is_some_and(|default| self.sound_is_escape_hatch(&default))
                    {
                        mask::TOP
                    } else {
                        self.sound_resolve(arg.sound_type)
                    };
                    add(FieldKey::Name(name), m);
                }
            }
        }
        fields.retain(|(_, m)| *m != mask::TOP);
        let instance = if self.sound_types_infer() {
            let members = self.sound_class_members(class);
            let base = match class.extends.map(|extends| extends.data) {
                Some(ExprData::EIdentifier(id)) => {
                    let base = self.load_name_from_ref(id.ref_);
                    let types = &mut self.sound().types;
                    let base = types.reference(base, SoundType::TOP);
                    types.instance_of_subclass(base)
                }
                _ => SoundType::from_mask(mask::OBJECT),
            };
            self.sound().types.object(base, members)
        } else {
            SoundType::TOP
        };
        self.sound().classes.push(ClassFields { fields, instance });
    }

    pub(crate) fn sound_leave_class(&mut self) {
        self.sound().classes.pop();
    }

    /// What `FnOnlyDataVisit::sound_this_class` should be while `this` is an
    /// instance of the innermost class being visited.
    pub(crate) fn sound_current_class(&mut self) -> u32 {
        self.sound().classes.len() as u32
    }

    /// The next `visit_func` visits an instance method of the innermost class.
    pub(crate) fn sound_next_fn_is_instance_method(&mut self) {
        let state = self.sound();
        state.next_fn_this_class = state.classes.len() as u32;
    }

    pub(crate) fn sound_take_next_fn_this_class(&mut self) -> u32 {
        core::mem::take(&mut self.sound().next_fn_this_class)
    }

    /// The mask of `this.<field>` for a visited or unvisited member expression.
    fn sound_this_field_mask(&mut self, member: &ExprData) -> Mask {
        let class = self.fn_only_data_visit.sound_this_class;
        if class == 0 {
            return mask::TOP;
        }
        let key = match member {
            ExprData::EDot(dot)
                if dot.optional_chain.is_none()
                    && matches!(dot.target.data, ExprData::EThis(_)) =>
            {
                FieldKey::Name(dot.name.slice())
            }
            ExprData::EIndex(index)
                if index.optional_chain.is_none()
                    && matches!(index.target.data, ExprData::EThis(_)) =>
            {
                match index.index.data {
                    ExprData::EPrivateIdentifier(private) if private.ref_.is_symbol() => {
                        FieldKey::Private(private.ref_)
                    }
                    _ => return mask::TOP,
                }
            }
            _ => return mask::TOP,
        };
        self.sound().classes[class as usize - 1]
            .fields
            .iter()
            .find(|(k, _)| k.eql(&key))
            .map_or(mask::TOP, |(_, m)| *m)
    }

    /// Whether the unvisited `e` is somewhere a read of it can be wrapped in a call.
    pub(crate) fn sound_is_plain_read(&self, e: &Expr, in_: ExprIn) -> bool {
        fn same(a: &ExprData, b: &ExprData) -> bool {
            match (a, b) {
                (ExprData::EDot(a), ExprData::EDot(b)) => core::ptr::eq(a.as_ptr(), b.as_ptr()),
                (ExprData::EIndex(a), ExprData::EIndex(b)) => core::ptr::eq(a.as_ptr(), b.as_ptr()),
                _ => false,
            }
        }
        in_.assign_target == js_ast::AssignTarget::None
            && !self.is_revisit_for_substitution
            && (self.fn_only_data_visit.sound_this_class != 0 || self.sound_types_infer())
            && !same(&e.data, &self.call_target)
            && !same(&e.data, &self.delete_target)
            && !same(&e.data, &self.template_tag)
    }

    /// `e` is a visited member expression that `sound_is_plain_read` accepted.
    pub(crate) fn sound_check_field_read(&mut self, e: &mut Expr) {
        let m = self.sound_this_field_mask(&e.data);
        if m == mask::TOP && self.sound_types_infer() {
            let m = self.sound_read_mask(e);
            *e = self.sound_check(*e, m, Rule::Read);
            return;
        }
        *e = self.sound_check(*e, m, Rule::FieldRead);
    }

    // ── Inference ────────────────────────────────────────────────────────

    #[inline]
    fn sound_mask_of(&mut self, t: Located) -> Mask {
        let state = self.sound();
        state.resolver.mask_of(&state.types, t)
    }

    /// The mask to check a read of the visited member expression `e` against:
    /// `TOP` unless its TypeScript type is a primitive. Knowing only that a value
    /// is an object is of little use.
    fn sound_read_mask(&mut self, e: &Expr) -> Mask {
        let t = self.sound_infer(e, 0);
        let mut m = self.sound_mask_of(t);
        // Nor which kind, unless it is a kind whose elements can be got at directly.
        if m == mask::TOP
            || (m & (mask::OBJECT & !mask::TYPED_ARRAYS) != 0
                && !bun_ast::sound_types::oracle::keeps_objects())
        {
            return mask::TOP;
        }
        // TypeScript's type does not include it, but the element may not exist.
        if matches!(e.data, ExprData::EIndex(_)) {
            m |= mask::UNDEFINED;
        }
        m
    }

    /// A best-effort approximation of the TypeScript type of the visited expression `e`.
    /// It must not be relied on: it only decides where a check is worth emitting.
    pub(crate) fn sound_infer(&mut self, e: &Expr, depth: u32) -> Located {
        let t = self.sound_infer_unaided(e, depth);
        if !t.is_top() || self.sound().oracle.is_none() {
            return t;
        }
        // EXPERIMENT: see `bun_ast::sound_types::oracle`.
        let anchor = match e.data {
            ExprData::EDot(dot) => dot.name_loc.start,
            ExprData::ECall(call) => call.close_paren_loc.start,
            ExprData::ENew(_) | ExprData::EAwait(_) | ExprData::EIdentifier(_) => e.loc.start,
            _ => return t,
        };
        Located::from_mask(self.sound_oracle(anchor))
    }

    /// EXPERIMENT: what `bun_ast::sound_types::oracle` says of what has that anchor.
    fn sound_oracle(&mut self, anchor: i32) -> Mask {
        let Some(entries) = self.sound().oracle else {
            return mask::TOP;
        };
        if self.sound().oracle_is_for_iteration_only && !self.sound().is_marking_iteration {
            return mask::TOP;
        }
        let m = bun_ast::sound_types::oracle::mask_at(entries, anchor);
        if m != mask::TOP && bun_ast::sound_types::stats::is_requested() {
            bun_ast::sound_types::stats::bump("oracle had an answer".to_owned());
        }
        m
    }

    fn sound_infer_unaided(&mut self, e: &Expr, depth: u32) -> Located {
        if depth >= STATIC_MASK_MAX_DEPTH {
            return Located::TOP;
        }
        match e.data {
            ExprData::EIdentifier(id) => {
                let index = id.ref_.inner_index();
                let ty = self.symbols[index as usize].sound_type;
                if !ty.is_top() {
                    return Located::own(ty);
                }
                self.sound()
                    .inferred
                    .get(&index)
                    .copied()
                    .unwrap_or(Located::TOP)
            }
            ExprData::EThis(_) => {
                let class = self.fn_only_data_visit.sound_this_class;
                if class == 0 {
                    return Located::TOP;
                }
                Located::own(self.sound().classes[class as usize - 1].instance)
            }
            // What a chain comes to when it is cut short is `undefined`, and no part of
            // one can be wrapped in a call without cutting it up.
            ExprData::EDot(dot) if dot.optional_chain.is_some() => Located::TOP,
            ExprData::EIndex(index) if index.optional_chain.is_some() => Located::TOP,
            ExprData::EDot(dot) => {
                let target = self.sound_infer(&dot.target, depth + 1);
                let state = self.sound();
                state.resolver.member(&state.types, target, dot.name.slice())
            }
            ExprData::EIndex(index) => {
                let key = self.sound_infer(&index.index, depth + 1);
                if self.sound_mask_of(key) != mask::NUMBER {
                    return Located::TOP;
                }
                let target = self.sound_infer(&index.target, depth + 1);
                let state = self.sound();
                state.resolver.element(&state.types, target)
            }
            ExprData::ENew(new) => {
                let ExprData::EIdentifier(id) = new.target.data else {
                    return Located::from_mask(mask::OBJECT);
                };
                let name = self.load_name_from_ref(id.ref_);
                Located::own(self.sound().types.reference(name, SoundType::TOP))
            }
            ExprData::ECall(call) => {
                if let Some(m) = self.sound_mask_of_check(&call) {
                    // The structure, if there is any: the check has nothing to say about that.
                    let value = self.sound_infer(call.args.at(0), depth + 1);
                    return if value.is_top() || self.sound_mask_of(value) & !m != 0 {
                        Located::from_mask(m)
                    } else {
                        value
                    };
                }
                if call.optional_chain.is_some() {
                    return Located::TOP;
                }
                match call.target.data {
                    ExprData::EIdentifier(target) => self
                        .sound()
                        .fn_returns
                        .get(&target.ref_.inner_index())
                        .map_or(Located::TOP, |&ty| Located::own(ty)),
                    ExprData::EDot(dot) => {
                        if let ExprData::EIdentifier(object) = dot.target.data
                            && self.symbols[object.ref_.inner_index() as usize].kind
                                == js_ast::symbol::Kind::Unbound
                            && self.load_name_from_ref(object.ref_) == b"Math"
                        {
                            return Located::from_mask(mask::NUMBER);
                        }
                        let object = self.sound_infer(&dot.target, depth + 1);
                        if self.sound_mask_of(object) == mask::STRING {
                            return Located::from_mask(string_method_mask(dot.name.slice()));
                        }
                        let state = self.sound();
                        let method = state.resolver.member(&state.types, object, dot.name.slice());
                        state.resolver.returns(&state.types, method)
                    }
                    _ => Located::TOP,
                }
            }
            ExprData::EBinary(binary)
                if matches!(
                    binary.op,
                    Op::Code::BinAdd
                        | Op::Code::BinSub
                        | Op::Code::BinMul
                        | Op::Code::BinDiv
                        | Op::Code::BinRem
                        | Op::Code::BinPow
                        | Op::Code::BinShl
                        | Op::Code::BinShr
                        | Op::Code::BinBitwiseOr
                        | Op::Code::BinBitwiseAnd
                        | Op::Code::BinBitwiseXor
                ) =>
            {
                let left = self.sound_infer(&binary.left, depth + 1);
                let right = self.sound_infer(&binary.right, depth + 1);
                let (left, right) = (self.sound_mask_of(left), self.sound_mask_of(right));
                if left == mask::NUMBER && right == mask::NUMBER {
                    Located::from_mask(mask::NUMBER)
                } else if binary.op == Op::Code::BinAdd
                    && (left == mask::STRING || right == mask::STRING)
                {
                    Located::from_mask(mask::STRING)
                } else {
                    Located::TOP
                }
            }
            ExprData::EUnary(unary)
                if matches!(
                    unary.op,
                    Op::Code::UnNeg
                        | Op::Code::UnCpl
                        | Op::Code::UnPreInc
                        | Op::Code::UnPreDec
                        | Op::Code::UnPostInc
                        | Op::Code::UnPostDec
                ) =>
            {
                let value = self.sound_infer(&unary.value, depth + 1);
                if self.sound_mask_of(value) == mask::NUMBER {
                    value
                } else {
                    Located::TOP
                }
            }
            ExprData::EIf(e) => {
                let yes = self.sound_infer(&e.yes, depth + 1);
                let no = self.sound_infer(&e.no, depth + 1);
                if yes == no { yes } else { Located::TOP }
            }
            _ => Located::from_mask(self.sound_static_mask(e, depth)),
        }
    }

    /// `<binding> = <value>` declares a variable that has no annotation.
    /// `value` has been visited.
    pub(crate) fn sound_infer_variable(&mut self, binding: &js_ast::Binding, value: &mut Expr) {
        let B::B::BIdentifier(id) = binding.data else {
            return;
        };
        let index = id.r#ref.inner_index();
        if !id.r#ref.is_symbol() || !self.symbols[index as usize].sound_type.is_top() {
            return;
        }
        let t = self.sound_infer(value, 0);
        // `let x = null`, `let x = undefined` and `let x = []` say nothing about `x`.
        let m = self.sound_mask_of(t);
        if m == mask::TOP
            || m & !(mask::NULL | mask::UNDEFINED) == 0
            || matches!(value.data, ExprData::EArray(_))
        {
            return;
        }
        // `new Float64Array(n)` only creates one if the global has not been replaced.
        if m & !mask::TYPED_ARRAYS == 0 && m.is_power_of_two() {
            *value = self.sound_check(*value, m, Rule::VarInit);
        }
        self.sound().inferred.insert(index, t);
    }

    /// `for (<binding> of <iterable>)`. `iterable` has been visited.
    pub(crate) fn sound_infer_loop_variable(&mut self, binding: &js_ast::Binding, iterable: &Expr) {
        let B::B::BIdentifier(id) = binding.data else {
            return;
        };
        let index = id.r#ref.inner_index();
        if !id.r#ref.is_symbol() || !self.symbols[index as usize].sound_type.is_top() {
            return;
        }
        let t = self.sound_infer(iterable, 0);
        // Only what iterates over its elements.
        if self.sound_mask_of(t) & !(mask::ARRAY | mask::OTHER_OBJECT) != 0 {
            return;
        }
        let state = self.sound();
        let element = state.resolver.element(&state.types, t);
        if !element.is_top() {
            state.inferred.insert(index, element);
        }
    }

    // ── Stores ───────────────────────────────────────────────────────────

    /// Both operands of the assignment `e` have been visited.
    pub(crate) fn sound_check_assignment(&mut self, e: &mut E::Binary) {
        if self.is_revisit_for_substitution {
            return;
        }
        let (m, rule, variable) = match e.left.data {
            ExprData::EIdentifier(id) => {
                if id.must_keep_due_to_with_stmt() {
                    return;
                }
                let ty = self.symbols[id.ref_.inner_index() as usize].sound_type;
                (self.sound_resolve(ty), Rule::VarAssign, Some(id))
            }
            ExprData::EDot(_) | ExprData::EIndex(_) => (
                self.sound_this_field_mask(&e.left.data),
                Rule::FieldStore,
                None,
            ),
            _ => return,
        };
        if variable.is_none() && self.sound_types_infer() && self.sound_split_member_update(e) {
            return;
        }
        if m == mask::TOP {
            return;
        }
        let arithmetic = match e.op {
            Op::Code::BinAssign
            | Op::Code::BinLogicalOrAssign
            | Op::Code::BinLogicalAndAssign
            | Op::Code::BinNullishCoalescingAssign => {
                e.right = self.sound_check(e.right, m, rule);
                return;
            }
            Op::Code::BinAddAssign => Op::Code::BinAdd,
            // These produce a number or a bigint, whichever the variable held.
            _ if m & !(mask::NUMBER | mask::BIGINT) == 0 => return,
            Op::Code::BinSubAssign => Op::Code::BinSub,
            Op::Code::BinMulAssign => Op::Code::BinMul,
            Op::Code::BinDivAssign => Op::Code::BinDiv,
            Op::Code::BinRemAssign => Op::Code::BinRem,
            Op::Code::BinPowAssign => Op::Code::BinPow,
            Op::Code::BinShlAssign => Op::Code::BinShl,
            Op::Code::BinShrAssign => Op::Code::BinShr,
            Op::Code::BinUShrAssign => Op::Code::BinUShr,
            Op::Code::BinBitwiseOrAssign => Op::Code::BinBitwiseOr,
            Op::Code::BinBitwiseAndAssign => Op::Code::BinBitwiseAnd,
            Op::Code::BinBitwiseXorAssign => Op::Code::BinBitwiseXor,
            _ => return,
        };
        // `x += e` => `x = $$t(x + e, m)`. Evaluating a member target twice is observable.
        let Some(id) = variable else { return };
        let read = self.new_expr(id, e.left.loc);
        let result = self.new_expr(
            E::Binary {
                op: arithmetic,
                left: read,
                right: e.right,
            },
            e.left.loc,
        );
        let checked = self.sound_check(result, m, rule);
        if matches!(checked.data, ExprData::ECall(_)) {
            self.record_usage(id.ref_);
            e.op = Op::Code::BinAssign;
            e.right = checked;
        }
    }

    /// `o.f -= e` => `o.f = $$t(o.f, m) - e`, so that the value read is checked
    /// against its TypeScript type. Only done where writing `o.f` twice evaluates
    /// nothing twice, other than the original read and write.
    fn sound_split_member_update(&mut self, e: &mut E::Binary) -> bool {
        let arithmetic = match e.op {
            Op::Code::BinAddAssign => Op::Code::BinAdd,
            Op::Code::BinSubAssign => Op::Code::BinSub,
            Op::Code::BinMulAssign => Op::Code::BinMul,
            Op::Code::BinDivAssign => Op::Code::BinDiv,
            Op::Code::BinRemAssign => Op::Code::BinRem,
            _ => return false,
        };
        fn is_simple(e: &Expr) -> bool {
            matches!(
                e.data,
                ExprData::EIdentifier(_) | ExprData::EThis(_) | ExprData::ENumber(_)
            )
        }
        let read = match e.left.data {
            ExprData::EDot(dot) if dot.optional_chain.is_none() && is_simple(&dot.target) => {
                let target = self.sound_reuse_simple(dot.target);
                self.new_expr(
                    E::Dot {
                        target,
                        name: dot.name,
                        name_loc: dot.name_loc,
                        ..Default::default()
                    },
                    e.left.loc,
                )
            }
            ExprData::EIndex(index)
                if index.optional_chain.is_none()
                    && is_simple(&index.target)
                    && is_simple(&index.index) =>
            {
                let target = self.sound_reuse_simple(index.target);
                let key = self.sound_reuse_simple(index.index);
                self.new_expr(
                    E::Index {
                        target,
                        index: key,
                        optional_chain: None,
                        is_import_property_use: false,
                    },
                    e.left.loc,
                )
            }
            _ => return false,
        };
        let mut m = self.sound_read_mask(&read);
        // `undefined -= 1` is not something TypeScript lets through.
        m &= !mask::UNDEFINED;
        if m != mask::NUMBER && !(m == mask::STRING && arithmetic == Op::Code::BinAdd) {
            return false;
        }
        let checked = self.sound_check(read, m, Rule::Read);
        e.right = self.new_expr(
            E::Binary {
                op: arithmetic,
                left: checked,
                right: e.right,
            },
            e.left.loc,
        );
        e.op = Op::Code::BinAssign;
        true
    }

    /// Another use of a visited identifier, `this` or number.
    fn sound_reuse_simple(&mut self, e: Expr) -> Expr {
        if let ExprData::EIdentifier(id) = e.data {
            self.record_usage(id.ref_);
            return self.new_expr(id, e.loc);
        }
        e
    }

    // ── Calls ────────────────────────────────────────────────────────────

    /// `e` has been visited.
    pub(crate) fn sound_check_call_result(&mut self, e: &mut Expr) {
        if self.is_revisit_for_substitution {
            return;
        }
        let ExprData::ECall(call) = e.data else {
            return;
        };
        if call.optional_chain.is_some() {
            return;
        }
        // TEMPORARY-ANNOTATION-STATS
        let stats = bun_ast::sound_types::stats::is_requested();
        let bump = |what: &str| {
            if stats {
                bun_ast::sound_types::stats::bump(format!("call {what}"));
            }
        };
        let ExprData::EIdentifier(target) = call.target.data else {
            if self.sound_types_infer() && matches!(call.target.data, ExprData::EDot(_)) {
                let t = self.sound_infer(e, 0);
                let m = self.sound_mask_of(t);
                bump(if m == mask::TOP {
                    "of a method: result type not inferred"
                } else if m & mask::OBJECT == 0 {
                    "of a method: primitive result, checked"
                } else {
                    "of a method: object result inferred, dropped"
                });
                if m & mask::OBJECT == 0 || bun_ast::sound_types::oracle::keeps_objects() {
                    *e = self.sound_check(*e, m, Rule::Call);
                }
            } else {
                bump("of something else");
            }
            return;
        };
        let Some(&ty) = self.sound().fn_returns.get(&target.ref_.inner_index()) else {
            let kind = self.symbols[target.ref_.inner_index() as usize].kind;
            bump(if kind == js_ast::symbol::Kind::Import {
                "of an imported name: return type not looked up"
            } else {
                "of a local name with no recorded return type"
            });
            // EXPERIMENT: see `bun_ast::sound_types::oracle`.
            let m = self.sound_oracle(call.close_paren_loc.start);
            if m & mask::OBJECT == 0 || bun_ast::sound_types::oracle::keeps_objects() {
                *e = self.sound_check(*e, m, Rule::Call);
            }
            return;
        };
        let m = self.sound_resolve(ty);
        bump(if m == mask::TOP {
            "of a same-file function: return type is anything"
        } else {
            "of a same-file function: return type used"
        });
        *e = self.sound_check(*e, m, Rule::Call);
    }

    pub(crate) fn sound_flush_stats(&mut self) {
        if let Some(state) = self.sound_state.as_deref_mut() {
            bun_ast::sound_types::stats::add(&state.counts);
            state.counts.clear();
            if let Some(unresolved) = state.resolver.take_unresolved() {
                bun_ast::sound_types::stats::append_unresolved(&unresolved);
            }
        }
    }
}
