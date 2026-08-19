//! Zod schema transform (`bun build --zod-compiler`, `Bun.build({ zodCompiler: true })`, or `BUN_FEATURE_FLAG_EXPERIMENTAL_ZOD` for every transpiler): rewrites statically-analyzable zod v4 schema expressions into `__zod(() => original, "<ir json>"[, refs])` calls (`__zod` lives in src/runtime.js).

//! The wrapper exposes parse/safeParse/parseAsync/safeParseAsync backed by a validator compiled from the IR, and only constructs the real schema (by calling the thunk) when anything else is touched.

//! The fast path only proves success: any failed check or unmodeled construct materializes the real schema and re-runs the parse through zod, so errors and async validation are always zod's own.

//! Expressions stay untouched unless rooted at a `"zod"`/`"zod/v4"` import with side-effect-free arguments (the thunk re-evaluates them); recognized-but-unmodeled constructs keep the wrapper with an opaque IR that materializes on first parse.

use crate::p::P;
use bun_ast::{self as js_ast, E, Expr, Flags, G, OpCode};
use bun_collections::{ArrayHashMap, VecExt};
use bun_core::UnwrapOrOom;

pub(crate) struct ZodState {
    /// Local bindings holding the zod module namespace (`import { z }`, `import * as z`, default import).
    pub(crate) refs: ArrayHashMap<js_ast::Ref, ()>,
    /// Named imports from zod other than `z`/default: local ref -> imported name.
    pub(crate) member_refs: ArrayHashMap<js_ast::Ref, Vec<u8>>,
    /// Wrapper calls emitted by this pass, keyed by thunk arrow node address, so enclosing schema expressions can absorb wrapped children.
    pub(crate) wrapped: ArrayHashMap<usize, WrappedSchema>,
}

impl ZodState {
    pub(crate) fn init() -> ZodState {
        ZodState {
            refs: ArrayHashMap::default(),
            member_refs: ArrayHashMap::default(),
            wrapped: ArrayHashMap::default(),
        }
    }
}

#[derive(Clone)]
pub(crate) struct WrappedSchema {
    ir: Ir,
    refs: Vec<Expr>,
}

/// A numeric check argument: a statically-known f64 or a runtime ref slot.
#[derive(Clone)]
pub(crate) enum NumArg {
    Lit(f64),
    Ref(u32),
}

/// A string check argument: statically-known text or a runtime ref slot.
#[derive(Clone)]
pub(crate) enum StrArg {
    Lit(String),
    Ref(u32),
}

#[derive(Clone)]
pub(crate) enum ZCheck {
    Gte(NumArg),
    Lte(NumArg),
    Gt(NumArg),
    Lt(NumArg),
    MultipleOf(NumArg),
    Int,
    MinLen(NumArg),
    MaxLen(NumArg),
    LenEq(NumArg),
    Regex { source: String, flags: String },
    RegexRef(u32),
    StartsWith(StrArg),
    EndsWith(StrArg),
    Includes(StrArg),
    LowerCase,
    UpperCase,
    // Overwrites (transform the value in sequence):
    Trim,
    ToLowerCase,
    ToUpperCase,
    Normalize,
}

#[derive(Clone, Copy, PartialEq)]
pub(crate) enum Prim {
    Str,
    Num,
    Bool,
    BigInt,
    Date,
}

#[derive(Clone, Copy, PartialEq)]
pub(crate) enum Simple {
    Undefined,
    Null,
    Any,
    Unknown,
    Never,
    Void,
    NaN,
}

#[derive(Clone)]
pub(crate) enum LitVal {
    Str(String),
    Num(f64),
    Bool(bool),
    Null,
    Undefined,
    Ref(u32),
}

#[derive(Clone)]
pub(crate) enum IrVal {
    /// Pre-serialized JSON.
    Json(String),
    Ref(u32),
}

#[derive(Clone, Copy, PartialEq)]
pub(crate) enum WrapKind {
    Optional,
    Nullable,
    NonOptional,
}

#[derive(Clone)]
pub(crate) enum Ir {
    Prim {
        prim: Prim,
        coerce: bool,
        checks: Vec<ZCheck>,
    },
    Lit {
        values: Vec<LitVal>,
    },
    Enum {
        values: Vec<String>,
    },
    EnumRef(u32),
    Simple(Simple),
    Wrap {
        kind: WrapKind,
        inner: Box<Ir>,
    },
    Default {
        inner: Box<Ir>,
        value: IrVal,
        prefault: bool,
    },
    Catch {
        inner: Box<Ir>,
    },
    Refine {
        inner: Box<Ir>,
        fn_ref: u32,
    },
    Object {
        props: Vec<(String, Ir)>,
        /// `None` = strip (default), `Some(Never)` = strict, `Some(Unknown)` = passthrough/loose, otherwise `.catchall(s)`.
        catchall: Option<Box<Ir>>,
    },
    Array {
        el: Box<Ir>,
        checks: Vec<ZCheck>,
    },
    Tuple {
        items: Vec<Ir>,
        rest: Option<Box<Ir>>,
    },
    /// `z.record(z.string(), value)` only; other key schemas go opaque.
    Record {
        value: Box<Ir>,
    },
    Union {
        options: Vec<Ir>,
    },
    DUnion {
        disc: String,
        options: Vec<Ir>,
    },
    /// Runtime schema value at refs[i] (an unfoldable identifier or an unabsorbable wrapped child).
    Ref(u32),
    /// Recognized schema-producing expression the IR cannot model; the wrapper materializes on first parse.
    Opaque,
}

/// Outcome of extracting one expression in schema position.
enum Extracted {
    Ir(Ir),
    /// Not statically modelable or not provably pure: leave the outermost expression untouched.
    Bail,
}

const ZOD_PATHS: [&[u8]; 2] = [b"zod", b"zod/v4"];

enum ZodRoot {
    /// `z.<name>(...)` / folded namespace member / named ctor import.
    Ctor(Vec<u8>),
    /// `z.coerce.<name>(...)`.
    CoerceCtor(Vec<u8>),
}

enum ZodBinding {
    Namespace,
    Member(Vec<u8>),
}

impl<'a, const TYPESCRIPT: bool, const SCAN_ONLY: bool> P<'a, TYPESCRIPT, SCAN_ONLY> {
    /// Track local bindings of the zod namespace; `alias` is `None` for `import * as ns`, otherwise the imported name.
    pub(crate) fn zod_maybe_track_import(
        &mut self,
        path_text: &[u8],
        r#ref: js_ast::Ref,
        alias: Option<&[u8]>,
    ) {
        if !self.options.features.zod_transform || SCAN_ONLY {
            return;
        }
        if !ZOD_PATHS.contains(&path_text) {
            return;
        }
        match alias {
            None | Some(b"z") | Some(b"default") => {
                let _ = self.zod.refs.put(r#ref, ());
            }
            Some(name) => {
                let _ = self.zod.member_refs.put(r#ref, name.to_vec());
            }
        }
    }

    /// Entry point from `e_call` after target and arguments are visited; returns the replacement wrapper expression, or `None` to leave the call untouched.
    pub(crate) fn maybe_transform_zod_call(&mut self, expr: Expr) -> Option<Expr> {
        if SCAN_ONLY || (self.zod.refs.is_empty() && self.zod.member_refs.is_empty()) {
            return None;
        }
        // Cheap pre-filter: only call chains rooted at a zod binding or an already-wrapped child can produce a schema.
        {
            let call = match &expr.data {
                js_ast::ExprData::ECall(call) => call,
                _ => return None,
            };
            if !self.zod_chain_might_be_schema(call) {
                return None;
            }
        }
        let mut refs: Vec<Expr> = Vec::new();
        match self.zod_extract(expr, &mut refs, true) {
            Extracted::Ir(ir) => Some(self.zod_emit_wrapper(expr.loc, expr, ir, refs)),
            Extracted::Bail => None,
        }
    }

    /// Walk the call-target chain to its root to check whether it could be a zod schema expression, so extraction does not run on every call in the file.
    fn zod_chain_might_be_schema(&self, call: &E::Call) -> bool {
        let mut target = call.target;
        loop {
            match &target.data {
                js_ast::ExprData::EDot(dot) => target = dot.target,
                js_ast::ExprData::ECall(inner) => {
                    if self.zod_wrapped_lookup(inner).is_some() {
                        return true;
                    }
                    target = inner.target;
                }
                js_ast::ExprData::EIdentifier(id) => {
                    return self.zod_ref_is_zod(id.ref_);
                }
                js_ast::ExprData::EImportIdentifier(id) => {
                    return self.zod_ref_is_zod(id.ref_);
                }
                _ => return false,
            }
        }
    }

    fn zod_ref_is_zod(&self, r#ref: js_ast::Ref) -> bool {
        self.zod_binding_kind(r#ref).is_some()
    }

    /// How a zod binding is spelled: `Namespace` covers `import * as z`/`import { z }`/default imports; `Member(alias)` is a folded namespace member or a named import.
    fn zod_binding_kind(&self, r#ref: js_ast::Ref) -> Option<ZodBinding> {
        if self.zod.refs.contains_key(&r#ref) {
            return Some(ZodBinding::Namespace);
        }
        if let Some(name) = self.zod.member_refs.get(&r#ref) {
            return Some(ZodBinding::Member(name.clone()));
        }
        // Bundle-mode visiting folds `z.union` into a per-name import item registered only in import_items_for_namespace; reverse-check through the tracked namespace refs.
        let name: &[u8] = self.symbols[r#ref.inner_index() as usize]
            .original_name
            .slice();
        if name.is_empty() {
            return None;
        }
        for entry in self.zod.refs.keys() {
            if let Some(items) = self.import_items_for_namespace.get(entry) {
                if let Some(loc_ref) = items.get(name) {
                    if loc_ref.ref_ == r#ref {
                        return Some(ZodBinding::Member(name.to_vec()));
                    }
                }
            }
        }
        None
    }

    /// Classify `expr` if it is a call to a known-schema zod constructor (directly or via `z.coerce`).
    fn zod_root_of(&self, call: &E::Call) -> Option<ZodRoot> {
        if call.optional_chain.is_some() {
            return None;
        }
        fn ref_of(expr: &Expr) -> Option<js_ast::Ref> {
            match &expr.data {
                js_ast::ExprData::EIdentifier(id) => Some(id.ref_),
                js_ast::ExprData::EImportIdentifier(id) => Some(id.ref_),
                _ => None,
            }
        }
        match &call.target.data {
            js_ast::ExprData::EDot(dot) => {
                if dot.optional_chain.is_some() {
                    return None;
                }
                if let Some(r) = ref_of(&dot.target) {
                    return match self.zod_binding_kind(r)? {
                        ZodBinding::Namespace => Some(ZodRoot::Ctor(dot.name.slice().to_vec())),
                        // `z.coerce` folded to a member import: coerce.string()
                        ZodBinding::Member(alias) if alias == b"coerce" => {
                            Some(ZodRoot::CoerceCtor(dot.name.slice().to_vec()))
                        }
                        // Unknown nested namespace (z.iso.date(), z.core.*): not a modeled constructor.
                        ZodBinding::Member(_) => None,
                    };
                }
                // `z.coerce.string()` with `z` still a plain namespace ref.
                if let js_ast::ExprData::EDot(inner) = &dot.target.data {
                    if inner.name.slice() == b"coerce" && inner.optional_chain.is_none() {
                        if let Some(r) = ref_of(&inner.target) {
                            if matches!(self.zod_binding_kind(r), Some(ZodBinding::Namespace)) {
                                return Some(ZodRoot::CoerceCtor(dot.name.slice().to_vec()));
                            }
                        }
                    }
                }
                None
            }
            // Direct ctor binding: folded namespace member or named import, e.g. `union([...])` or `import { object } from "zod"`.
            js_ast::ExprData::EIdentifier(_) | js_ast::ExprData::EImportIdentifier(_) => {
                let r = ref_of(&call.target)?;
                match self.zod_binding_kind(r)? {
                    ZodBinding::Member(name) if name != b"coerce" => Some(ZodRoot::Ctor(name)),
                    _ => None,
                }
            }
            _ => None,
        }
    }

    /// Look up a previously emitted wrapper call for absorption.
    fn zod_wrapped_lookup(&self, call: &E::Call) -> Option<usize> {
        if call.args.len_u32() < 2 {
            return None;
        }
        let key = match &call.args.slice()[0].data {
            js_ast::ExprData::EArrow(arrow) => core::ptr::from_ref::<E::Arrow>(&**arrow) as usize,
            _ => return None,
        };
        if self.zod.wrapped.contains_key(&key) {
            Some(key)
        } else {
            None
        }
    }

    /// Extract the IR for one schema-position expression. `outermost` is true only for the wrapper root; unmodelable inner expressions become `Ref`s (if pure) rather than bailing the tree.
    fn zod_extract(&mut self, expr: Expr, refs: &mut Vec<Expr>, outermost: bool) -> Extracted {
        match &expr.data {
            js_ast::ExprData::ECall(call_ref) => {
                // Re-absorb a child this pass already wrapped; opaque children dissolve too, delegating only when a parse actually reaches them.
                if let Some(key) = self.zod_wrapped_lookup(call_ref) {
                    if let Some(mut wrapped) = self.zod.wrapped.get(&key).cloned() {
                        // Dissolve the child wrapper into the parent: revert the call node to its thunk body, append its refs to the parent's, and drop its recorded __zod usage.
                        self.zod.wrapped.swap_remove(&key);
                        let mut call_mut: js_ast::StoreRef<E::Call> = *call_ref;
                        let arrow_expr = call_mut.args.slice()[0];
                        if let js_ast::ExprData::EArrow(arrow) = arrow_expr.data {
                            if let [stmt] = arrow.body.stmts.slice() {
                                if let js_ast::StmtData::SReturn(ret) = &stmt.data {
                                    if let Some(orig) = ret.value {
                                        if let js_ast::ExprData::ECall(orig_call) = orig.data {
                                            let mut oc = orig_call;
                                            call_mut.target = oc.target;
                                            call_mut.args = core::mem::replace(
                                                &mut oc.args,
                                                bun_alloc::AstAlloc::vec(),
                                            );
                                            call_mut.optional_chain = oc.optional_chain;
                                            call_mut.is_direct_eval = oc.is_direct_eval;
                                            call_mut.close_paren_loc = oc.close_paren_loc;
                                            call_mut.can_be_unwrapped_if_unused =
                                                oc.can_be_unwrapped_if_unused;
                                            call_mut.was_jsx_element = oc.was_jsx_element;
                                        }
                                    }
                                }
                            }
                        }
                        let delta = refs.len() as u32;
                        wrapped.ir.shift_refs(delta);
                        refs.append(&mut wrapped.refs);
                        let ref_ = self.runtime_identifier_ref(b"__zod");
                        self.ignore_usage(ref_);
                        return Extracted::Ir(wrapped.ir);
                    }
                }

                let call: &E::Call = call_ref;
                if let Some(root) = self.zod_root_of(call) {
                    let (name, coerce) = match root {
                        ZodRoot::Ctor(name) => (name, false),
                        ZodRoot::CoerceCtor(name) => (name, true),
                    };
                    // Copy args handle out; extraction recurses into self.
                    let args: Vec<Expr> = call.args.slice().to_vec();
                    return self.zod_extract_ctor(&name, coerce, &args, refs);
                }

                // Method call on a schema expression: `<base>.min(5)`.
                if call.optional_chain.is_some() {
                    return Extracted::Bail;
                }
                if let js_ast::ExprData::EDot(dot) = &call.target.data {
                    if dot.optional_chain.is_none() {
                        let method: &[u8] = dot.name.slice();
                        let base = dot.target;
                        let args: Vec<Expr> = call.args.slice().to_vec();
                        let is_schema_base = matches!(&base.data, js_ast::ExprData::ECall(_));
                        if is_schema_base {
                            let method = method.to_vec();
                            match self.zod_extract(base, refs, false) {
                                Extracted::Ir(base_ir) => {
                                    return self.zod_apply_method(base_ir, &method, &args, refs);
                                }
                                Extracted::Bail => return Extracted::Bail,
                            }
                        }
                    }
                }

                // Unrecognized expression: as a child it is an unknown runtime value (it may be a schema built elsewhere); at the root there is nothing to wrap.
                if outermost {
                    Extracted::Bail
                } else {
                    self.zod_pure_ref(expr, refs)
                }
            }
            _ => {
                if outermost {
                    Extracted::Bail
                } else {
                    self.zod_pure_ref(expr, refs)
                }
            }
        }
    }

    /// A recognized schema call the IR cannot model keeps the lazy wrapper only when every argument is side-effect-free; otherwise the expression is left untouched to preserve evaluation order.
    fn zod_opaque_or_bail(&self, args: &[Expr]) -> Extracted {
        if args.iter().all(|a| self.zod_is_pure_value(*a)) {
            Extracted::Ir(Ir::Opaque)
        } else {
            Extracted::Bail
        }
    }

    /// Args past the ones a modeled construct consumes: ignorable error params stay compiled, anything else defers to zod (pure) or bails (impure).
    fn zod_extra_args(&mut self, args: &[Expr], consumed: usize) -> Option<Extracted> {
        for extra in args.iter().skip(consumed) {
            if !self.zod_is_ignorable_params(*extra) {
                return Some(self.zod_opaque_or_bail(args));
            }
        }
        None
    }

    /// Child expression that is not a recognized zod call: allowed as a runtime ref when provably pure, otherwise the whole tree bails.
    fn zod_pure_ref(&mut self, expr: Expr, refs: &mut Vec<Expr>) -> Extracted {
        if !self.zod_is_pure_value(expr) {
            return Extracted::Bail;
        }
        let idx = refs.len() as u32;
        refs.push(expr);
        Extracted::Ir(Ir::Ref(idx))
    }

    /// Side-effect-free-by-syntax whitelist: safe to evaluate eagerly (refs array) and again lazily (thunk) with no divergence beyond object identity.
    fn zod_is_pure_value(&self, expr: Expr) -> bool {
        match &expr.data {
            js_ast::ExprData::EString(_)
            | js_ast::ExprData::ENumber(_)
            | js_ast::ExprData::EBoolean(_)
            | js_ast::ExprData::ENull(_)
            | js_ast::ExprData::EUndefined(_)
            | js_ast::ExprData::EBigInt(_)
            | js_ast::ExprData::ERegExp(_)
            | js_ast::ExprData::EArrow(_)
            | js_ast::ExprData::EFunction(_)
            | js_ast::ExprData::EMissing(_) => true,
            // Reassignable bindings could change between the eager refs capture and the thunk's re-evaluation, so only same-file consts qualify; imports are live bindings whose exporter-side constness is invisible here.
            js_ast::ExprData::EIdentifier(id) => matches!(
                self.symbols[id.ref_.inner_index() as usize].kind,
                js_ast::symbol::Kind::Constant
            ),
            js_ast::ExprData::EImportIdentifier(_) => false,
            // Operators on pure operands count as pure: a side-effecting valueOf/toString could observe the re-run, but zod applies the same operators to the same values while parsing.
            js_ast::ExprData::EUnary(u) => {
                matches!(
                    u.op,
                    OpCode::UnNeg
                        | OpCode::UnPos
                        | OpCode::UnNot
                        | OpCode::UnCpl
                        | OpCode::UnVoid
                        | OpCode::UnTypeof
                ) && self.zod_is_pure_value(u.value)
            }
            js_ast::ExprData::EBinary(b) => {
                matches!(
                    b.op,
                    OpCode::BinAdd
                        | OpCode::BinSub
                        | OpCode::BinMul
                        | OpCode::BinDiv
                        | OpCode::BinRem
                        | OpCode::BinPow
                        | OpCode::BinLt
                        | OpCode::BinLe
                        | OpCode::BinGt
                        | OpCode::BinGe
                        | OpCode::BinShl
                        | OpCode::BinShr
                        | OpCode::BinUShr
                        | OpCode::BinLooseEq
                        | OpCode::BinLooseNe
                        | OpCode::BinStrictEq
                        | OpCode::BinStrictNe
                        | OpCode::BinNullishCoalescing
                        | OpCode::BinLogicalOr
                        | OpCode::BinLogicalAnd
                        | OpCode::BinBitwiseOr
                        | OpCode::BinBitwiseAnd
                        | OpCode::BinBitwiseXor
                ) && self.zod_is_pure_value(b.left)
                    && self.zod_is_pure_value(b.right)
            }
            js_ast::ExprData::EIf(i) => {
                self.zod_is_pure_value(i.test)
                    && self.zod_is_pure_value(i.yes)
                    && self.zod_is_pure_value(i.no)
            }
            // Wrapper calls this pass emitted are pure by construction (thunk + IR string + pure refs), e.g. as arguments inside z.lazy(...).
            js_ast::ExprData::ECall(c) => self.zod_wrapped_lookup(c).is_some(),
            js_ast::ExprData::ETemplate(t) => {
                t.tag.is_none()
                    && t.parts
                        .slice()
                        .iter()
                        .all(|part| self.zod_is_pure_value(part.value))
            }
            js_ast::ExprData::EArray(arr) => arr
                .items
                .slice()
                .iter()
                .all(|item| self.zod_is_pure_value(*item)),
            js_ast::ExprData::EObject(obj) => obj.properties.slice().iter().all(|prop| {
                prop.kind == G::PropertyKind::Normal
                    && !prop.flags.contains(Flags::Property::IsComputed)
                    && !prop.flags.contains(Flags::Property::IsMethod)
                    && !prop.flags.contains(Flags::Property::IsSpread)
                    && match prop.key {
                        Some(key) => matches!(
                            key.data,
                            js_ast::ExprData::EString(_) | js_ast::ExprData::ENumber(_)
                        ),
                        None => false,
                    }
                    && match prop.value {
                        Some(value) => self.zod_is_pure_value(value),
                        None => false,
                    }
            }),
            _ => false,
        }
    }

    fn zod_extract_ctor(
        &mut self,
        name: &[u8],
        coerce: bool,
        args: &[Expr],
        refs: &mut Vec<Expr>,
    ) -> Extracted {
        // Constructors taking an optional trailing params object/string; params only affect error reporting, which always goes through the real schema.
        macro_rules! params_ok {
            ($idx:expr) => {
                match args.get($idx) {
                    None => true,
                    Some(p) => self.zod_is_ignorable_params(*p),
                }
            };
        }

        if coerce {
            let prim = match name {
                b"string" => Prim::Str,
                b"number" => Prim::Num,
                b"boolean" => Prim::Bool,
                b"bigint" => Prim::BigInt,
                b"date" => Prim::Date,
                _ => return self.zod_schema_valued_fallback(name, args),
            };
            if !params_ok!(0) || args.len() > 1 {
                return self.zod_opaque_or_bail(args);
            }
            return Extracted::Ir(Ir::Prim {
                prim,
                coerce: true,
                checks: Vec::new(),
            });
        }

        match name {
            b"string" | b"number" | b"boolean" | b"bigint" | b"date" => {
                let prim = match name {
                    b"string" => Prim::Str,
                    b"number" => Prim::Num,
                    b"boolean" => Prim::Bool,
                    b"bigint" => Prim::BigInt,
                    _ => Prim::Date,
                };
                if !params_ok!(0) || args.len() > 1 {
                    return self.zod_opaque_or_bail(args);
                }
                Extracted::Ir(Ir::Prim {
                    prim,
                    coerce: false,
                    checks: Vec::new(),
                })
            }
            b"int" => {
                if !params_ok!(0) || args.len() > 1 {
                    return self.zod_opaque_or_bail(args);
                }
                Extracted::Ir(Ir::Prim {
                    prim: Prim::Num,
                    coerce: false,
                    checks: vec![ZCheck::Int],
                })
            }
            b"undefined" | b"null" | b"any" | b"unknown" | b"never" | b"void" | b"nan" => {
                if !params_ok!(0) || args.len() > 1 {
                    return self.zod_opaque_or_bail(args);
                }
                Extracted::Ir(Ir::Simple(match name {
                    b"undefined" => Simple::Undefined,
                    b"null" => Simple::Null,
                    b"any" => Simple::Any,
                    b"unknown" => Simple::Unknown,
                    b"never" => Simple::Never,
                    b"void" => Simple::Void,
                    _ => Simple::NaN,
                }))
            }
            b"literal" => {
                if args.is_empty() || !params_ok!(1) || args.len() > 2 {
                    return self.zod_opaque_or_bail(args);
                }
                let mut values: Vec<LitVal> = Vec::new();
                let arg = args[0];
                let items: Vec<Expr> = match &arg.data {
                    js_ast::ExprData::EArray(arr) => arr.items.slice().to_vec(),
                    _ => vec![arg],
                };
                for item in items {
                    match self.zod_literal_value(item, refs) {
                        Some(v) => values.push(v),
                        None => return self.zod_opaque_or_bail(args),
                    }
                }
                // zod's $ZodLiteral constructor throws on an empty value list; bailing keeps that throw at module load instead of first parse.
                if values.is_empty() {
                    return Extracted::Bail;
                }
                Extracted::Ir(Ir::Lit { values })
            }
            b"enum" => {
                if args.is_empty() || !params_ok!(1) || args.len() > 2 {
                    return self.zod_opaque_or_bail(args);
                }
                match &args[0].data {
                    js_ast::ExprData::EArray(arr) => {
                        let mut values: Vec<String> = Vec::new();
                        for item in arr.items.slice() {
                            match self.zod_string_value(*item) {
                                Some(s) => values.push(s),
                                None => return self.zod_opaque_or_bail(args),
                            }
                        }
                        Extracted::Ir(Ir::Enum { values })
                    }
                    js_ast::ExprData::EIdentifier(_) | js_ast::ExprData::EImportIdentifier(_) => {
                        if !self.zod_is_pure_value(args[0]) {
                            return Extracted::Bail;
                        }
                        // Array of strings by const reference; TS enum objects also land here and the helper delegates for non-arrays at runtime.
                        let idx = refs.len() as u32;
                        refs.push(args[0]);
                        Extracted::Ir(Ir::EnumRef(idx))
                    }
                    _ => self.zod_opaque_or_bail(args),
                }
            }
            b"array" => {
                if args.is_empty() {
                    return self.zod_opaque_or_bail(args);
                }
                if !params_ok!(1) || args.len() > 2 {
                    return self.zod_opaque_or_bail(args);
                }
                match self.zod_extract(args[0], refs, false) {
                    Extracted::Ir(el) => Extracted::Ir(Ir::Array {
                        el: Box::new(el),
                        checks: Vec::new(),
                    }),
                    Extracted::Bail => Extracted::Bail,
                }
            }
            b"object" | b"strictObject" | b"looseObject" => {
                if args.is_empty() || !params_ok!(1) || args.len() > 2 {
                    return self.zod_opaque_or_bail(args);
                }
                let catchall = match name {
                    b"strictObject" => Some(Box::new(Ir::Simple(Simple::Never))),
                    b"looseObject" => Some(Box::new(Ir::Simple(Simple::Unknown))),
                    _ => None,
                };
                match self.zod_extract_shape(args[0], refs) {
                    Some(Extracted::Ir(Ir::Object { props, .. })) => {
                        Extracted::Ir(Ir::Object { props, catchall })
                    }
                    Some(Extracted::Bail) => Extracted::Bail,
                    _ => self.zod_opaque_or_bail(args),
                }
            }
            b"union" => {
                if args.is_empty() || !params_ok!(1) || args.len() > 2 {
                    return self.zod_opaque_or_bail(args);
                }
                match self.zod_extract_schema_array(args[0], refs) {
                    Some(Extracted::Ir(ir)) => Extracted::Ir(ir),
                    Some(Extracted::Bail) => Extracted::Bail,
                    None => self.zod_opaque_or_bail(args),
                }
            }
            b"discriminatedUnion" => {
                if args.len() < 2 || !params_ok!(2) || args.len() > 3 {
                    return self.zod_opaque_or_bail(args);
                }
                let disc = match self.zod_string_value(args[0]) {
                    Some(s) => s,
                    None => return self.zod_opaque_or_bail(args),
                };
                match self.zod_extract_schema_array(args[1], refs) {
                    Some(Extracted::Ir(Ir::Union { options })) => {
                        // Needs statically-derivable discriminator values on every option; otherwise parse through the real schema.
                        if options.iter().all(|o| o.derivable_disc_values(&disc)) {
                            Extracted::Ir(Ir::DUnion { disc, options })
                        } else {
                            self.zod_opaque_or_bail(args)
                        }
                    }
                    Some(Extracted::Bail) => Extracted::Bail,
                    _ => self.zod_opaque_or_bail(args),
                }
            }
            b"tuple" => {
                if args.is_empty() || args.len() > 2 {
                    return self.zod_opaque_or_bail(args);
                }
                let items = match &args[0].data {
                    js_ast::ExprData::EArray(arr) => arr.items.slice().to_vec(),
                    _ => return self.zod_opaque_or_bail(args),
                };
                let mut item_irs: Vec<Ir> = Vec::with_capacity(items.len());
                for item in items {
                    match self.zod_extract(item, refs, false) {
                        Extracted::Ir(ir) => item_irs.push(ir),
                        Extracted::Bail => return Extracted::Bail,
                    }
                }
                let rest = match args.get(1) {
                    Some(rest_expr) => match self.zod_extract(*rest_expr, refs, false) {
                        Extracted::Ir(ir) => Some(Box::new(ir)),
                        Extracted::Bail => return Extracted::Bail,
                    },
                    None => None,
                };
                Extracted::Ir(Ir::Tuple {
                    items: item_irs,
                    rest,
                })
            }
            b"record" => {
                if args.len() != 2 {
                    return self.zod_opaque_or_bail(args);
                }
                // Only plain-string keys compile; enum/literal keys have required-key semantics and go through the real schema.
                let key_is_plain_string = match self.zod_extract(args[0], refs, false) {
                    Extracted::Ir(Ir::Prim {
                        prim: Prim::Str,
                        coerce: false,
                        checks,
                    }) => checks.is_empty(),
                    Extracted::Bail => return Extracted::Bail,
                    _ => false,
                };
                if !key_is_plain_string {
                    return self.zod_opaque_or_bail(args);
                }
                match self.zod_extract(args[1], refs, false) {
                    Extracted::Ir(value) => Extracted::Ir(Ir::Record {
                        value: Box::new(value),
                    }),
                    Extracted::Bail => Extracted::Bail,
                }
            }
            b"optional" => self.zod_wrap_ctor(WrapKind::Optional, args, refs),
            b"nullable" => self.zod_wrap_ctor(WrapKind::Nullable, args, refs),
            b"nullish" => {
                if let Some(out) = self.zod_extra_args(args, 1) {
                    return out;
                }
                match args.first() {
                    Some(inner) => match self.zod_extract(*inner, refs, false) {
                        Extracted::Ir(ir) => Extracted::Ir(Ir::Wrap {
                            kind: WrapKind::Optional,
                            inner: Box::new(Ir::Wrap {
                                kind: WrapKind::Nullable,
                                inner: Box::new(ir),
                            }),
                        }),
                        Extracted::Bail => Extracted::Bail,
                    },
                    None => self.zod_opaque_or_bail(args),
                }
            }
            _ => self.zod_schema_valued_fallback(name, args),
        }
    }

    fn zod_wrap_ctor(&mut self, kind: WrapKind, args: &[Expr], refs: &mut Vec<Expr>) -> Extracted {
        if let Some(out) = self.zod_extra_args(args, 1) {
            return out;
        }
        match args.first() {
            Some(inner) => match self.zod_extract(*inner, refs, false) {
                Extracted::Ir(ir) => Extracted::Ir(Ir::Wrap {
                    kind,
                    inner: Box::new(ir),
                }),
                Extracted::Bail => Extracted::Bail,
            },
            None => self.zod_opaque_or_bail(args),
        }
    }

    /// Constructors known to produce schemas the IR cannot model: lazy wrapper with opaque IR. Anything not listed is not provably a schema and stays untouched.
    fn zod_schema_valued_fallback(&mut self, name: &[u8], args: &[Expr]) -> Extracted {
        const OPAQUE_SCHEMA_CTORS: &[&[u8]] = &[
            b"email",
            b"url",
            b"httpUrl",
            b"uuid",
            b"uuidv4",
            b"uuidv6",
            b"uuidv7",
            b"guid",
            b"nanoid",
            b"cuid",
            b"cuid2",
            b"ulid",
            b"xid",
            b"ksuid",
            b"emoji",
            b"base64",
            b"base64url",
            b"e164",
            b"jwt",
            b"ipv4",
            b"ipv6",
            b"cidrv4",
            b"cidrv6",
            b"mac",
            b"hostname",
            b"hash",
            b"hex",
            b"symbol",
            b"nativeEnum",
            b"map",
            b"set",
            b"intersection",
            b"lazy",
            b"promise",
            b"preprocess",
            b"pipe",
            b"transform",
            b"custom",
            b"instanceof",
            b"file",
            b"json",
            b"stringbool",
            b"templateLiteral",
            b"float32",
            b"float64",
            b"int32",
            b"uint32",
            b"int64",
            b"uint64",
            b"success",
            b"xor",
            b"codec",
            b"partialRecord",
            b"interface",
            b"strictInterface",
            b"looseInterface",
            b"keyof",
            b"function",
            b"stringFormat",
            b"date32",
        ];
        if OPAQUE_SCHEMA_CTORS.contains(&name) {
            self.zod_opaque_or_bail(args)
        } else {
            Extracted::Bail
        }
    }

    fn zod_extract_shape(&mut self, expr: Expr, refs: &mut Vec<Expr>) -> Option<Extracted> {
        let obj = match &expr.data {
            js_ast::ExprData::EObject(obj) => obj,
            _ => return None,
        };
        let props: Vec<(Option<Expr>, Option<Expr>, G::PropertyKind, bool)> = obj
            .properties
            .slice()
            .iter()
            .map(|p| {
                (
                    p.key,
                    p.value,
                    p.kind,
                    p.flags.contains(Flags::Property::IsComputed),
                )
            })
            .collect();
        let mut out: Vec<(String, Ir)> = Vec::with_capacity(props.len());
        for (key, value, kind, is_computed) in props {
            if kind != G::PropertyKind::Normal || is_computed {
                return Some(Extracted::Bail);
            }
            let key_expr = key?;
            let key_str = self.zod_string_value(key_expr)?;
            // "__proto__" as a shape key interacts with plain-object assignment; let the real schema handle it.
            if key_str == "__proto__" {
                return Some(Extracted::Bail);
            }
            let value_expr = value?;
            match self.zod_extract(value_expr, refs, false) {
                Extracted::Ir(ir) => out.push((key_str, ir)),
                Extracted::Bail => return Some(Extracted::Bail),
            }
        }
        Some(Extracted::Ir(Ir::Object {
            props: out,
            catchall: None,
        }))
    }

    fn zod_extract_schema_array(&mut self, expr: Expr, refs: &mut Vec<Expr>) -> Option<Extracted> {
        let items: Vec<Expr> = match &expr.data {
            js_ast::ExprData::EArray(arr) => arr.items.slice().to_vec(),
            _ => return None,
        };
        let mut options: Vec<Ir> = Vec::with_capacity(items.len());
        for item in items {
            match self.zod_extract(item, refs, false) {
                Extracted::Ir(ir) => options.push(ir),
                Extracted::Bail => return Some(Extracted::Bail),
            }
        }
        Some(Extracted::Ir(Ir::Union { options }))
    }

    fn zod_apply_method(
        &mut self,
        base: Ir,
        method: &[u8],
        args: &[Expr],
        refs: &mut Vec<Expr>,
    ) -> Extracted {
        // Construction-time side effects cannot be deferred: .register() writes a user registry and .describe()/.meta() write zod's globalRegistry keyed by schema identity, so leave the expression untouched.
        if method == b"register" || method == b"describe" || method == b"meta" {
            return Extracted::Bail;
        }

        // `.brand()` returns `this`: purely type-level.
        if method == b"brand" {
            if let Some(out) = self.zod_extra_args(args, 0) {
                return out;
            }
            return Extracted::Ir(base);
        }

        match method {
            b"optional" => {
                if let Some(out) = self.zod_extra_args(args, 0) {
                    return out;
                }
                return Extracted::Ir(Ir::Wrap {
                    kind: WrapKind::Optional,
                    inner: Box::new(base),
                });
            }
            b"nullable" => {
                if let Some(out) = self.zod_extra_args(args, 0) {
                    return out;
                }
                return Extracted::Ir(Ir::Wrap {
                    kind: WrapKind::Nullable,
                    inner: Box::new(base),
                });
            }
            b"nullish" => {
                if let Some(out) = self.zod_extra_args(args, 0) {
                    return out;
                }
                return Extracted::Ir(Ir::Wrap {
                    kind: WrapKind::Optional,
                    inner: Box::new(Ir::Wrap {
                        kind: WrapKind::Nullable,
                        inner: Box::new(base),
                    }),
                });
            }
            b"default" | b"prefault" => {
                if let Some(out) = self.zod_extra_args(args, 1) {
                    return out;
                }
                let Some(arg) = args.first() else {
                    return self.zod_opaque_or_bail(args);
                };
                let value = match self.zod_json_value(*arg) {
                    Some(json) => IrVal::Json(json),
                    None => {
                        if !self.zod_is_pure_value(*arg) {
                            return Extracted::Bail;
                        }
                        let idx = refs.len() as u32;
                        refs.push(*arg);
                        IrVal::Ref(idx)
                    }
                };
                return Extracted::Ir(Ir::Default {
                    inner: Box::new(base),
                    value,
                    prefault: method == b"prefault",
                });
            }
            b"catch" => {
                if let Some(out) = self.zod_extra_args(args, 1) {
                    return out;
                }
                let Some(arg) = args.first() else {
                    return self.zod_opaque_or_bail(args);
                };
                // The catch value only matters on the failure path (always through the real schema) but must still be safe to re-evaluate in the thunk.
                if !self.zod_is_pure_value(*arg) {
                    return Extracted::Bail;
                }
                return Extracted::Ir(Ir::Catch {
                    inner: Box::new(base),
                });
            }
            b"refine" => {
                if let Some(out) = self.zod_extra_args(args, 2) {
                    return out;
                }
                let Some(arg) = args.first() else {
                    return self.zod_opaque_or_bail(args);
                };
                let fn_ok = matches!(
                    arg.data,
                    js_ast::ExprData::EArrow(_)
                        | js_ast::ExprData::EFunction(_)
                        | js_ast::ExprData::EIdentifier(_)
                        | js_ast::ExprData::EImportIdentifier(_)
                );
                if !fn_ok || !self.zod_is_pure_value(*arg) {
                    return Extracted::Bail;
                }
                if let Some(params) = args.get(1) {
                    if !self.zod_is_ignorable_params(*params) {
                        if !self.zod_is_pure_value(*params) {
                            return Extracted::Bail;
                        }
                        // Unrecognized but pure params (e.g. { abort: true }) change which issues are collected, never whether fully-valid input succeeds.
                    }
                }
                let idx = refs.len() as u32;
                refs.push(*arg);
                return Extracted::Ir(Ir::Refine {
                    inner: Box::new(base),
                    fn_ref: idx,
                });
            }
            b"array" => {
                if let Some(out) = self.zod_extra_args(args, 0) {
                    return out;
                }
                return Extracted::Ir(Ir::Array {
                    el: Box::new(base),
                    checks: Vec::new(),
                });
            }
            b"or" => {
                if let Some(out) = self.zod_extra_args(args, 1) {
                    return out;
                }
                let Some(arg) = args.first() else {
                    return self.zod_opaque_or_bail(args);
                };
                return match self.zod_extract(*arg, refs, false) {
                    Extracted::Ir(other) => Extracted::Ir(Ir::Union {
                        options: vec![base, other],
                    }),
                    Extracted::Bail => Extracted::Bail,
                };
            }
            _ => {}
        }

        // Object-shape algebra.
        if let Ir::Object { props, catchall } = base {
            match method {
                b"strict" => {
                    if let Some(out) = self.zod_extra_args(args, 0) {
                        return out;
                    }
                    return Extracted::Ir(Ir::Object {
                        props,
                        catchall: Some(Box::new(Ir::Simple(Simple::Never))),
                    });
                }
                b"passthrough" | b"loose" => {
                    if let Some(out) = self.zod_extra_args(args, 0) {
                        return out;
                    }
                    return Extracted::Ir(Ir::Object {
                        props,
                        catchall: Some(Box::new(Ir::Simple(Simple::Unknown))),
                    });
                }
                b"strip" => {
                    if let Some(out) = self.zod_extra_args(args, 0) {
                        return out;
                    }
                    return Extracted::Ir(Ir::Object {
                        props,
                        catchall: None,
                    });
                }
                b"catchall" => {
                    if let Some(out) = self.zod_extra_args(args, 1) {
                        return out;
                    }
                    let Some(arg) = args.first() else {
                        return self.zod_opaque_or_bail(args);
                    };
                    return match self.zod_extract(*arg, refs, false) {
                        Extracted::Ir(ca) => Extracted::Ir(Ir::Object {
                            props,
                            catchall: Some(Box::new(ca)),
                        }),
                        Extracted::Bail => Extracted::Bail,
                    };
                }
                b"extend" => {
                    if let Some(out) = self.zod_extra_args(args, 1) {
                        return out;
                    }
                    let Some(arg) = args.first() else {
                        return self.zod_opaque_or_bail(args);
                    };
                    return match self.zod_extract_shape(*arg, refs) {
                        Some(Extracted::Ir(Ir::Object { props: added, .. })) => {
                            let mut merged = props;
                            for (key, ir) in added {
                                if let Some(existing) = merged.iter_mut().find(|(k, _)| *k == key) {
                                    existing.1 = ir;
                                } else {
                                    merged.push((key, ir));
                                }
                            }
                            Extracted::Ir(Ir::Object {
                                props: merged,
                                catchall,
                            })
                        }
                        Some(Extracted::Bail) => Extracted::Bail,
                        _ => self.zod_opaque_or_bail(args),
                    };
                }
                b"pick" | b"omit" => {
                    if let Some(out) = self.zod_extra_args(args, 1) {
                        return out;
                    }
                    let Some(arg) = args.first() else {
                        return self.zod_opaque_or_bail(args);
                    };
                    let Some(keys) = self.zod_true_mask_keys(*arg) else {
                        return self.zod_opaque_or_bail(args);
                    };
                    // zod throws Unrecognized key from its lazy shape getter on first parse; defer so it does.
                    if !keys.iter().all(|m| props.iter().any(|(k, _)| k == m)) {
                        return self.zod_opaque_or_bail(args);
                    }
                    // zod's util.pick builds the new shape by iterating the mask, so picked keys take the mask's order; omit starts from the old shape and keeps its order.
                    let picked: Vec<(String, Ir)> = if method == b"pick" {
                        keys.iter()
                            .filter_map(|m| props.iter().find(|(k, _)| k == m).cloned())
                            .collect()
                    } else {
                        props
                            .into_iter()
                            .filter(|(k, _)| !keys.iter().any(|m| m == k))
                            .collect()
                    };
                    return Extracted::Ir(Ir::Object {
                        props: picked,
                        catchall,
                    });
                }
                b"partial" => {
                    if let Some(out) = self.zod_extra_args(args, 1) {
                        return out;
                    }
                    let mask = match args.first() {
                        Some(arg) => match self.zod_true_mask_keys(*arg) {
                            Some(keys) => Some(keys),
                            None => return self.zod_opaque_or_bail(args),
                        },
                        None => None,
                    };
                    if let Some(keys) = &mask {
                        if !keys.iter().all(|m| props.iter().any(|(k, _)| k == m)) {
                            return self.zod_opaque_or_bail(args);
                        }
                    }
                    let wrapped: Vec<(String, Ir)> = props
                        .into_iter()
                        .map(|(k, ir)| {
                            let apply = match &mask {
                                Some(keys) => keys.iter().any(|m| m == &k),
                                None => true,
                            };
                            if apply {
                                let ir = Ir::Wrap {
                                    kind: WrapKind::Optional,
                                    inner: Box::new(ir),
                                };
                                (k, ir)
                            } else {
                                (k, ir)
                            }
                        })
                        .collect();
                    return Extracted::Ir(Ir::Object {
                        props: wrapped,
                        catchall,
                    });
                }
                b"required" => {
                    if let Some(out) = self.zod_extra_args(args, 1) {
                        return out;
                    }
                    let mask = match args.first() {
                        Some(arg) => match self.zod_true_mask_keys(*arg) {
                            Some(keys) => Some(keys),
                            None => return self.zod_opaque_or_bail(args),
                        },
                        None => None,
                    };
                    if let Some(keys) = &mask {
                        if !keys.iter().all(|m| props.iter().any(|(k, _)| k == m)) {
                            return self.zod_opaque_or_bail(args);
                        }
                    }
                    let wrapped: Vec<(String, Ir)> = props
                        .into_iter()
                        .map(|(k, ir)| {
                            let apply = match &mask {
                                Some(keys) => keys.iter().any(|m| m == &k),
                                None => true,
                            };
                            if apply {
                                let ir = Ir::Wrap {
                                    kind: WrapKind::NonOptional,
                                    inner: Box::new(ir),
                                };
                                (k, ir)
                            } else {
                                (k, ir)
                            }
                        })
                        .collect();
                    return Extracted::Ir(Ir::Object {
                        props: wrapped,
                        catchall,
                    });
                }
                _ => {
                    // Fall through to the check-style methods below with the object reassembled.
                    return self.zod_apply_check_method(
                        Ir::Object { props, catchall },
                        method,
                        args,
                        refs,
                    );
                }
            }
        }

        self.zod_apply_check_method(base, method, args, refs)
    }

    fn zod_apply_check_method(
        &mut self,
        base: Ir,
        method: &[u8],
        args: &[Expr],
        refs: &mut Vec<Expr>,
    ) -> Extracted {
        // Numeric-argument checks; an optional second arg is a message/params object and only affects failures.
        let num_arg = |p: &mut Self, refs: &mut Vec<Expr>| -> Option<NumArg> {
            let arg = args.first()?;
            if let Some(n) = p.zod_number_value(*arg) {
                return Some(NumArg::Lit(n));
            }
            if p.zod_is_pure_value(*arg) {
                let idx = refs.len() as u32;
                refs.push(*arg);
                return Some(NumArg::Ref(idx));
            }
            None
        };
        let str_arg = |p: &mut Self, refs: &mut Vec<Expr>| -> Option<StrArg> {
            let arg = args.first()?;
            if let Some(s) = p.zod_string_value(*arg) {
                return Some(StrArg::Lit(s));
            }
            if p.zod_is_pure_value(*arg) {
                let idx = refs.len() as u32;
                refs.push(*arg);
                return Some(StrArg::Ref(idx));
            }
            None
        };

        let prim_kind = match &base {
            Ir::Prim { prim, .. } => Some(*prim),
            Ir::Array { .. } => None,
            _ => None,
        };

        let check: Option<ZCheck> = match method {
            b"min" => num_arg(self, refs).map(|v| match prim_kind {
                Some(Prim::Num) | Some(Prim::BigInt) | Some(Prim::Date) => ZCheck::Gte(v),
                _ => ZCheck::MinLen(v),
            }),
            b"max" => num_arg(self, refs).map(|v| match prim_kind {
                Some(Prim::Num) | Some(Prim::BigInt) | Some(Prim::Date) => ZCheck::Lte(v),
                _ => ZCheck::MaxLen(v),
            }),
            b"length" => num_arg(self, refs).map(ZCheck::LenEq),
            b"gt" => num_arg(self, refs).map(ZCheck::Gt),
            b"gte" => num_arg(self, refs).map(ZCheck::Gte),
            b"lt" => num_arg(self, refs).map(ZCheck::Lt),
            b"lte" => num_arg(self, refs).map(ZCheck::Lte),
            b"multipleOf" | b"step" => num_arg(self, refs).map(ZCheck::MultipleOf),
            b"int" => Some(ZCheck::Int),
            b"safe" => Some(ZCheck::Int),
            b"positive" => Some(ZCheck::Gt(NumArg::Lit(0.0))),
            b"negative" => Some(ZCheck::Lt(NumArg::Lit(0.0))),
            b"nonnegative" => Some(ZCheck::Gte(NumArg::Lit(0.0))),
            b"nonpositive" => Some(ZCheck::Lte(NumArg::Lit(0.0))),
            // z.number() is already finite-only in zod v4.
            b"finite" => {
                if matches!(prim_kind, Some(Prim::Num)) {
                    if let Some(out) = self.zod_extra_args(args, 0) {
                        return out;
                    }
                    return Extracted::Ir(base);
                }
                None
            }
            b"nonempty" => Some(ZCheck::MinLen(NumArg::Lit(1.0))),
            b"regex" => match args.first() {
                Some(arg) => match &arg.data {
                    js_ast::ExprData::ERegExp(re) => {
                        let source = match core::str::from_utf8(re.pattern()) {
                            Ok(s) => s.to_string(),
                            Err(_) => return self.zod_opaque_or_bail(args),
                        };
                        let flags = match core::str::from_utf8(re.flags()) {
                            Ok(s) => s.to_string(),
                            Err(_) => return self.zod_opaque_or_bail(args),
                        };
                        Some(ZCheck::Regex { source, flags })
                    }
                    js_ast::ExprData::EIdentifier(_) | js_ast::ExprData::EImportIdentifier(_) => {
                        if !self.zod_is_pure_value(*arg) {
                            return Extracted::Bail;
                        }
                        let idx = refs.len() as u32;
                        refs.push(*arg);
                        Some(ZCheck::RegexRef(idx))
                    }
                    _ => None,
                },
                None => None,
            },
            b"startsWith" => str_arg(self, refs).map(ZCheck::StartsWith),
            b"endsWith" => str_arg(self, refs).map(ZCheck::EndsWith),
            b"includes" => str_arg(self, refs).map(ZCheck::Includes),
            b"lowercase" => Some(ZCheck::LowerCase),
            b"uppercase" => Some(ZCheck::UpperCase),
            b"trim" => Some(ZCheck::Trim),
            b"toLowerCase" => Some(ZCheck::ToLowerCase),
            b"toUpperCase" => Some(ZCheck::ToUpperCase),
            b"normalize" => {
                if args.is_empty() {
                    Some(ZCheck::Normalize)
                } else {
                    None
                }
            }
            _ => {
                // Unknown method on a schema expression: known schema-returning methods keep the lazy wrapper; anything else leaves the expression alone.
                const OPAQUE_SCHEMA_METHODS: &[&[u8]] = &[
                    b"transform",
                    b"superRefine",
                    b"check",
                    b"overwrite",
                    b"pipe",
                    b"readonly",
                    b"and",
                    b"merge",
                    b"keyof",
                    b"element",
                    b"unwrap",
                    b"date",
                    b"datetime",
                    b"time",
                    b"duration",
                    b"email",
                    b"url",
                    b"uuid",
                    b"emoji",
                    b"nanoid",
                    b"cuid",
                    b"cuid2",
                    b"ulid",
                    b"base64",
                    b"base64url",
                    b"ip",
                    b"cidr",
                    b"jwt",
                    b"json",
                    b"rest",
                    b"sparse",
                ];
                if OPAQUE_SCHEMA_METHODS.contains(&method) {
                    return self.zod_opaque_or_bail(args);
                }
                return Extracted::Bail;
            }
        };

        let Some(check) = check else {
            return self.zod_opaque_or_bail(args);
        };
        // Zero-arg checks consume nothing, so their params slot is args[0], not args[1].
        let consumed = usize::from(matches!(
            method,
            b"min"
                | b"max"
                | b"length"
                | b"gt"
                | b"gte"
                | b"lt"
                | b"lte"
                | b"multipleOf"
                | b"step"
                | b"regex"
                | b"startsWith"
                | b"endsWith"
                | b"includes"
        ));
        // Extra args past the check value: a recognizable message/params object stays compiled, other pure args might change acceptance so the schema defers to zod, impure args bail.
        if let Some(out) = self.zod_extra_args(args, consumed) {
            return out;
        }

        match base {
            Ir::Prim {
                prim,
                coerce,
                mut checks,
            } => {
                checks.push(check);
                Extracted::Ir(Ir::Prim {
                    prim,
                    coerce,
                    checks,
                })
            }
            Ir::Array { el, mut checks } => match check {
                ZCheck::MinLen(_) | ZCheck::MaxLen(_) | ZCheck::LenEq(_) => {
                    checks.push(check);
                    Extracted::Ir(Ir::Array { el, checks })
                }
                _ => self.zod_opaque_or_bail(args),
            },
            // Checks on wrappers/objects (e.g. .min on something folded differently) are out of model.
            _ => self.zod_opaque_or_bail(args),
        }
    }

    /// `{ a: true, b: true }` masks for pick/omit/partial/required.
    fn zod_true_mask_keys(&mut self, expr: Expr) -> Option<Vec<String>> {
        let obj = match &expr.data {
            js_ast::ExprData::EObject(obj) => obj,
            _ => return None,
        };
        let props: Vec<(Option<Expr>, Option<Expr>, G::PropertyKind, bool)> = obj
            .properties
            .slice()
            .iter()
            .map(|p| {
                (
                    p.key,
                    p.value,
                    p.kind,
                    p.flags.contains(Flags::Property::IsComputed),
                )
            })
            .collect();
        let mut keys: Vec<String> = Vec::with_capacity(props.len());
        for (key, value, kind, is_computed) in props {
            if kind != G::PropertyKind::Normal || is_computed {
                return None;
            }
            let key_str = self.zod_string_value(key?)?;
            match value?.data {
                js_ast::ExprData::EBoolean(b) if b.value => {}
                _ => return None,
            }
            keys.push(key_str);
        }
        Some(keys)
    }

    /// A trailing params argument that provably cannot change the success path: a string message, or an object literal whose keys only affect error reporting.
    fn zod_is_ignorable_params(&mut self, expr: Expr) -> bool {
        match &expr.data {
            js_ast::ExprData::EString(_) => true,
            js_ast::ExprData::EObject(obj) => obj.properties.slice().iter().all(|prop| {
                if prop.kind != G::PropertyKind::Normal
                    || prop.flags.contains(Flags::Property::IsComputed)
                {
                    return false;
                }
                let Some(key) = prop.key else { return false };
                let Some(value) = prop.value else {
                    return false;
                };
                let key_name = match self.zod_string_value_imm(key) {
                    Some(k) => k,
                    None => return false,
                };
                matches!(
                    key_name.as_str(),
                    "message" | "error" | "description" | "invalid_type_error" | "required_error"
                ) && self.zod_is_pure_value(value)
            }),
            _ => false,
        }
    }

    fn zod_string_value(&mut self, expr: Expr) -> Option<String> {
        self.zod_string_value_imm(expr)
    }

    fn zod_string_value_imm(&self, expr: Expr) -> Option<String> {
        match &expr.data {
            js_ast::ExprData::EString(s) => {
                let bytes = s.string(self.arena).ok()?;
                Some(core::str::from_utf8(bytes).ok()?.to_string())
            }
            _ => None,
        }
    }

    fn zod_number_value(&self, expr: Expr) -> Option<f64> {
        let n = match &expr.data {
            js_ast::ExprData::ENumber(n) => n.value(),
            js_ast::ExprData::EUnary(u) if u.op == OpCode::UnNeg => match &u.value.data {
                js_ast::ExprData::ENumber(n) => -n.value(),
                _ => return None,
            },
            _ => return None,
        };
        // Non-finite values (1e400, NaN) have no IR JSON representation; format_f64 asserts finiteness.
        n.is_finite().then_some(n)
    }

    fn zod_literal_value(&mut self, expr: Expr, refs: &mut Vec<Expr>) -> Option<LitVal> {
        match &expr.data {
            js_ast::ExprData::EString(_) => Some(LitVal::Str(self.zod_string_value(expr)?)),
            js_ast::ExprData::ENumber(_) | js_ast::ExprData::EUnary(_) => {
                Some(LitVal::Num(self.zod_number_value(expr)?))
            }
            js_ast::ExprData::EBoolean(b) => Some(LitVal::Bool(b.value)),
            js_ast::ExprData::ENull(_) => Some(LitVal::Null),
            js_ast::ExprData::EUndefined(_) => Some(LitVal::Undefined),
            _ => {
                if self.zod_is_pure_value(expr) {
                    let idx = refs.len() as u32;
                    refs.push(expr);
                    Some(LitVal::Ref(idx))
                } else {
                    None
                }
            }
        }
    }

    /// JSON-serializable literal (for inline default values); returns the serialized JSON text.
    fn zod_json_value(&mut self, expr: Expr) -> Option<String> {
        match &expr.data {
            js_ast::ExprData::EString(_) => {
                let s = self.zod_string_value(expr)?;
                let mut out = String::with_capacity(s.len() + 2);
                write_json_string(&mut out, &s);
                Some(out)
            }
            js_ast::ExprData::ENumber(_) | js_ast::ExprData::EUnary(_) => {
                Some(format_f64(self.zod_number_value(expr)?))
            }
            js_ast::ExprData::EBoolean(b) => {
                Some(if b.value { "true" } else { "false" }.to_string())
            }
            js_ast::ExprData::ENull(_) => Some("null".to_string()),
            _ => None,
        }
    }

    /// Build the `__zod(() => original, "<ir json>"[, [refs...]])` call and register it for absorption by enclosing schema expressions.
    fn zod_emit_wrapper(
        &mut self,
        loc: bun_ast::Loc,
        original: Expr,
        ir: Ir,
        refs: Vec<Expr>,
    ) -> Expr {
        let body = G::FnBody::init_return_expr(self.arena, original).unwrap_or_oom();
        let thunk = self.new_expr(
            E::Arrow {
                args: js_ast::StoreSlice::EMPTY,
                body,
                prefer_expr: true,
                ..Default::default()
            },
            loc,
        );

        let mut json = String::with_capacity(128);
        json.push_str("{\"v\":1,\"n\":");
        ir.write_json(&mut json);
        json.push('}');
        let bytes: &mut [u8] = self.arena.alloc_slice_copy(json.as_bytes());
        let ir_str = self.new_expr(
            E::EString {
                data: (&*bytes).into(),
                ..Default::default()
            },
            loc,
        );

        let arg_count: usize = if refs.is_empty() { 2 } else { 3 };
        let mut args = js_ast::ExprNodeList::init_capacity(arg_count);
        args.push(thunk);
        args.push(ir_str);
        if !refs.is_empty() {
            let mut items = js_ast::ExprNodeList::init_capacity(refs.len());
            for r in &refs {
                items.push(*r);
            }
            let refs_array = self.new_expr(
                E::Array {
                    items,
                    ..Default::default()
                },
                loc,
            );
            args.push(refs_array);
        }

        let call = self.call_runtime(loc, b"__zod", args);
        if let js_ast::ExprData::ECall(mut c) = call.data {
            c.can_be_unwrapped_if_unused = E::CallUnwrap::IfUnused;
        }

        // Register for absorption, keyed by the thunk arrow node address.
        if let js_ast::ExprData::EArrow(arrow) = &thunk.data {
            let key = core::ptr::from_ref::<E::Arrow>(&**arrow) as usize;
            let _ = self.zod.wrapped.put(key, WrappedSchema { ir, refs });
        }
        call
    }
}

impl Ir {
    /// Shift every refs-array index by `delta` (when a child wrapper's refs are appended to its parent's).
    fn shift_refs(&mut self, delta: u32) {
        if delta == 0 {
            return;
        }
        let shift_check = |c: &mut ZCheck| {
            let shift_num = |v: &mut NumArg| {
                if let NumArg::Ref(i) = v {
                    *i += delta;
                }
            };
            let shift_str = |v: &mut StrArg| {
                if let StrArg::Ref(i) = v {
                    *i += delta;
                }
            };
            match c {
                ZCheck::Gte(v)
                | ZCheck::Lte(v)
                | ZCheck::Gt(v)
                | ZCheck::Lt(v)
                | ZCheck::MultipleOf(v)
                | ZCheck::MinLen(v)
                | ZCheck::MaxLen(v)
                | ZCheck::LenEq(v) => shift_num(v),
                ZCheck::StartsWith(v) | ZCheck::EndsWith(v) | ZCheck::Includes(v) => shift_str(v),
                ZCheck::RegexRef(i) => *i += delta,
                _ => {}
            }
        };
        match self {
            Ir::Prim { checks, .. } | Ir::Array { checks, .. } => {
                for c in checks.iter_mut() {
                    shift_check(c);
                }
                if let Ir::Array { el, .. } = self {
                    el.shift_refs(delta);
                }
            }
            Ir::Lit { values } => {
                for v in values.iter_mut() {
                    if let LitVal::Ref(i) = v {
                        *i += delta;
                    }
                }
            }
            Ir::EnumRef(i) => *i += delta,
            Ir::Wrap { inner, .. } | Ir::Catch { inner } => inner.shift_refs(delta),
            Ir::Default { inner, value, .. } => {
                inner.shift_refs(delta);
                if let IrVal::Ref(i) = value {
                    *i += delta;
                }
            }
            Ir::Refine { inner, fn_ref } => {
                inner.shift_refs(delta);
                *fn_ref += delta;
            }
            Ir::Object { props, catchall } => {
                for (_, ir) in props.iter_mut() {
                    ir.shift_refs(delta);
                }
                if let Some(ca) = catchall {
                    ca.shift_refs(delta);
                }
            }
            Ir::Tuple { items, rest } => {
                for ir in items.iter_mut() {
                    ir.shift_refs(delta);
                }
                if let Some(rest) = rest {
                    rest.shift_refs(delta);
                }
            }
            Ir::Record { value } => value.shift_refs(delta),
            Ir::Union { options } | Ir::DUnion { options, .. } => {
                for ir in options.iter_mut() {
                    ir.shift_refs(delta);
                }
            }
            Ir::Ref(i) => *i += delta,
            Ir::Simple(_) | Ir::Enum { .. } | Ir::Opaque => {}
        }
    }

    /// Whether a discriminated-union option statically exposes literal/enum values for `disc`.
    fn derivable_disc_values(&self, disc: &str) -> bool {
        match self {
            Ir::Object { props, .. } => props.iter().any(|(k, ir)| {
                k == disc
                    && match ir {
                        Ir::Lit { values } => values.iter().all(|v| !matches!(v, LitVal::Ref(_))),
                        Ir::Enum { .. } => true,
                        _ => false,
                    }
            }),
            Ir::Refine { inner, .. } => inner.derivable_disc_values(disc),
            _ => false,
        }
    }

    fn write_json(&self, out: &mut String) {
        let write_checks = |out: &mut String, checks: &[ZCheck]| {
            if checks.is_empty() {
                return;
            }
            out.push_str(",\"c\":[");
            for (i, c) in checks.iter().enumerate() {
                if i > 0 {
                    out.push(',');
                }
                let num = |out: &mut String, v: &NumArg| match v {
                    NumArg::Lit(n) => out.push_str(&format_f64(*n)),
                    NumArg::Ref(i) => {
                        out.push_str("{\"r\":");
                        out.push_str(&i.to_string());
                        out.push('}');
                    }
                };
                let stra = |out: &mut String, v: &StrArg| match v {
                    StrArg::Lit(s) => write_json_string(out, s),
                    StrArg::Ref(i) => {
                        out.push_str("{\"r\":");
                        out.push_str(&i.to_string());
                        out.push('}');
                    }
                };
                match c {
                    ZCheck::Gte(v) => {
                        out.push_str("[\"gte\",");
                        num(out, v);
                        out.push(']');
                    }
                    ZCheck::Lte(v) => {
                        out.push_str("[\"lte\",");
                        num(out, v);
                        out.push(']');
                    }
                    ZCheck::Gt(v) => {
                        out.push_str("[\"gt\",");
                        num(out, v);
                        out.push(']');
                    }
                    ZCheck::Lt(v) => {
                        out.push_str("[\"lt\",");
                        num(out, v);
                        out.push(']');
                    }
                    ZCheck::MultipleOf(v) => {
                        out.push_str("[\"mof\",");
                        num(out, v);
                        out.push(']');
                    }
                    ZCheck::Int => out.push_str("[\"int\"]"),
                    ZCheck::MinLen(v) => {
                        out.push_str("[\"minl\",");
                        num(out, v);
                        out.push(']');
                    }
                    ZCheck::MaxLen(v) => {
                        out.push_str("[\"maxl\",");
                        num(out, v);
                        out.push(']');
                    }
                    ZCheck::LenEq(v) => {
                        out.push_str("[\"lenl\",");
                        num(out, v);
                        out.push(']');
                    }
                    ZCheck::Regex { source, flags } => {
                        out.push_str("[\"re\",");
                        write_json_string(out, source);
                        out.push(',');
                        write_json_string(out, flags);
                        out.push(']');
                    }
                    ZCheck::RegexRef(i) => {
                        out.push_str("[\"rer\",");
                        out.push_str(&i.to_string());
                        out.push(']');
                    }
                    ZCheck::StartsWith(v) => {
                        out.push_str("[\"sw\",");
                        stra(out, v);
                        out.push(']');
                    }
                    ZCheck::EndsWith(v) => {
                        out.push_str("[\"ew\",");
                        stra(out, v);
                        out.push(']');
                    }
                    ZCheck::Includes(v) => {
                        out.push_str("[\"inc\",");
                        stra(out, v);
                        out.push(']');
                    }
                    ZCheck::LowerCase => out.push_str("[\"lc\"]"),
                    ZCheck::UpperCase => out.push_str("[\"uc\"]"),
                    ZCheck::Trim => out.push_str("[\"trim\"]"),
                    ZCheck::ToLowerCase => out.push_str("[\"tlc\"]"),
                    ZCheck::ToUpperCase => out.push_str("[\"tuc\"]"),
                    ZCheck::Normalize => out.push_str("[\"norm\"]"),
                }
            }
            out.push(']');
        };

        match self {
            Ir::Prim {
                prim,
                coerce,
                checks,
            } => {
                out.push_str("{\"k\":\"");
                out.push_str(match prim {
                    Prim::Str => "str",
                    Prim::Num => "num",
                    Prim::Bool => "bool",
                    Prim::BigInt => "big",
                    Prim::Date => "date",
                });
                out.push('"');
                if *coerce {
                    out.push_str(",\"co\":1");
                }
                write_checks(out, checks);
                out.push('}');
            }
            Ir::Lit { values } => {
                out.push_str("{\"k\":\"lit\",\"vs\":[");
                let mut first = true;
                let mut has_undefined = false;
                let mut ref_idxs: Vec<u32> = Vec::new();
                for v in values {
                    match v {
                        LitVal::Undefined => {
                            has_undefined = true;
                            continue;
                        }
                        LitVal::Ref(i) => {
                            ref_idxs.push(*i);
                            continue;
                        }
                        _ => {}
                    }
                    if !first {
                        out.push(',');
                    }
                    first = false;
                    match v {
                        LitVal::Str(s) => write_json_string(out, s),
                        LitVal::Num(n) => out.push_str(&format_f64(*n)),
                        LitVal::Bool(b) => out.push_str(if *b { "true" } else { "false" }),
                        LitVal::Null => out.push_str("null"),
                        LitVal::Undefined | LitVal::Ref(_) => unreachable!(),
                    }
                }
                out.push(']');
                if has_undefined {
                    out.push_str(",\"u\":1");
                }
                if !ref_idxs.is_empty() {
                    out.push_str(",\"rs\":[");
                    for (i, r) in ref_idxs.iter().enumerate() {
                        if i > 0 {
                            out.push(',');
                        }
                        out.push_str(&r.to_string());
                    }
                    out.push(']');
                }
                out.push('}');
            }
            Ir::Enum { values } => {
                out.push_str("{\"k\":\"enum\",\"vs\":[");
                for (i, v) in values.iter().enumerate() {
                    if i > 0 {
                        out.push(',');
                    }
                    write_json_string(out, v);
                }
                out.push_str("]}");
            }
            Ir::EnumRef(i) => {
                out.push_str("{\"k\":\"enum\",\"r\":");
                out.push_str(&i.to_string());
                out.push('}');
            }
            Ir::Simple(s) => {
                out.push_str("{\"k\":\"");
                out.push_str(match s {
                    Simple::Undefined => "undef",
                    Simple::Null => "null",
                    Simple::Any => "any",
                    Simple::Unknown => "unk",
                    Simple::Never => "never",
                    Simple::Void => "void",
                    Simple::NaN => "nan",
                });
                out.push_str("\"}");
            }
            Ir::Wrap { kind, inner } => {
                out.push_str(match kind {
                    WrapKind::Optional => "{\"k\":\"opt\",\"i\":",
                    WrapKind::Nullable => "{\"k\":\"nul\",\"i\":",
                    WrapKind::NonOptional => "{\"k\":\"non\",\"i\":",
                });
                inner.write_json(out);
                out.push('}');
            }
            Ir::Default {
                inner,
                value,
                prefault,
            } => {
                out.push_str("{\"k\":\"def\",\"i\":");
                inner.write_json(out);
                match value {
                    IrVal::Json(j) => {
                        out.push_str(",\"v\":");
                        out.push_str(j);
                    }
                    IrVal::Ref(i) => {
                        out.push_str(",\"r\":");
                        out.push_str(&i.to_string());
                    }
                }
                if *prefault {
                    out.push_str(",\"pf\":1");
                }
                out.push('}');
            }
            Ir::Catch { inner } => {
                out.push_str("{\"k\":\"catch\",\"i\":");
                inner.write_json(out);
                out.push('}');
            }
            Ir::Refine { inner, fn_ref } => {
                out.push_str("{\"k\":\"rfn\",\"i\":");
                inner.write_json(out);
                out.push_str(",\"r\":");
                out.push_str(&fn_ref.to_string());
                out.push('}');
            }
            Ir::Object { props, catchall } => {
                out.push_str("{\"k\":\"obj\",\"p\":[");
                for (i, (key, ir)) in props.iter().enumerate() {
                    if i > 0 {
                        out.push(',');
                    }
                    out.push('[');
                    write_json_string(out, key);
                    out.push(',');
                    ir.write_json(out);
                    out.push(']');
                }
                out.push(']');
                if let Some(ca) = catchall {
                    out.push_str(",\"ca\":");
                    ca.write_json(out);
                }
                out.push('}');
            }
            Ir::Array { el, checks } => {
                out.push_str("{\"k\":\"arr\",\"i\":");
                el.write_json(out);
                write_checks(out, checks);
                out.push('}');
            }
            Ir::Tuple { items, rest } => {
                out.push_str("{\"k\":\"tup\",\"it\":[");
                for (i, ir) in items.iter().enumerate() {
                    if i > 0 {
                        out.push(',');
                    }
                    ir.write_json(out);
                }
                out.push(']');
                if let Some(rest) = rest {
                    out.push_str(",\"rest\":");
                    rest.write_json(out);
                }
                out.push('}');
            }
            Ir::Record { value } => {
                out.push_str("{\"k\":\"rec\",\"v\":");
                value.write_json(out);
                out.push('}');
            }
            Ir::Union { options } => {
                out.push_str("{\"k\":\"uni\",\"o\":[");
                for (i, ir) in options.iter().enumerate() {
                    if i > 0 {
                        out.push(',');
                    }
                    ir.write_json(out);
                }
                out.push_str("]}");
            }
            Ir::DUnion { disc, options } => {
                out.push_str("{\"k\":\"dun\",\"d\":");
                write_json_string(out, disc);
                out.push_str(",\"o\":[");
                for (i, ir) in options.iter().enumerate() {
                    if i > 0 {
                        out.push(',');
                    }
                    ir.write_json(out);
                }
                out.push_str("]}");
            }
            Ir::Ref(i) => {
                out.push_str("{\"k\":\"ref\",\"r\":");
                out.push_str(&i.to_string());
                out.push('}');
            }
            Ir::Opaque => out.push_str("{\"k\":\"opq\"}"),
        }
    }
}

fn write_json_string(out: &mut String, s: &str) {
    out.push('"');
    for ch in s.chars() {
        match ch {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            '\u{08}' => out.push_str("\\b"),
            '\u{0c}' => out.push_str("\\f"),
            c if (c as u32) < 0x20 => {
                out.push_str(&format!("\\u{:04x}", c as u32));
            }
            // Escape JS line separators so the IR literal printed into JS source stays valid.
            '\u{2028}' => out.push_str("\\u2028"),
            '\u{2029}' => out.push_str("\\u2029"),
            c => out.push(c),
        }
    }
    out.push('"');
}

/// f64 to shortest-roundtrip decimal, JSON-safe (finite values only).
fn format_f64(n: f64) -> String {
    debug_assert!(n.is_finite());
    // JSON.parse("-0") preserves the sign; the i64 shortening below would not.
    if n == 0.0 && n.is_sign_negative() {
        return "-0".to_string();
    }
    if n == n.trunc() && n.abs() < 1e15 {
        format!("{}", n as i64)
    } else {
        format!("{}", n)
    }
}
