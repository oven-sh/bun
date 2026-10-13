//! From a function of the checker's HIR to the `bun_ast` the React Compiler lowers: the shape the parser's visit pass leaves. Types are
//! gone, a JSX element is a call, what the bundler replaces by a constant is replaced and the branches that leaves dead are dropped.
//!
//! A `Loc` is not an offset. It is a token: the nodes are numbered in source order as they are converted, and `Adapter::origins` has the
//! node of the HIR for each token.

use super::super::FileBuild;
use super::super::constants::Constant;
use super::super::jsx::jsx_text;
use super::host::Host;
use bun_alloc::{Arena, AstAlloc, AstVec};
use bun_ast::{
    ArrayBinding, Binding, Case, Catch, E, Expr, ExprNodeList, Finally, G, Loc, LocRef, OpCode, OptionalChain, Range, Ref, S, Stmt, StmtNodeList, StoreSlice, StoreStr, b, flags,
    symbol,
};
use bun_react_compiler::collections::IndexMap;
use bun_react_compiler::hir::VariableBinding;
use bun_react_compiler::{Host as _, JsxImportKind};
use bun_sema::atom::Atom;
use bun_sema::bind::{Bound, Decl, PatParent, ScopeKind, SymbolId};
use bun_sema::hir::{
    self, BinOp, CallId, CaseId, Chain, ExprId, ExprKind, Flags, FnBody, FnId, FnKind, IdList, JsxId, NameKind, PatId, PatKind, PropId, PropKey, PropKind, Span, StmtId, StmtKind, UnOp,
    VarDeclId, VarKind,
};
use bun_sema::program::FileId;
use rustc_hash::FxHashMap;

/// How tokens are spelled as `Loc`s. The compiler is to make the same of a function under each.
#[derive(Copy, Clone)]
pub(super) enum Numbering {
    /// The token itself.
    Dense,
    /// In the same order, `SPARSE_STRIDE` apart, give or take.
    Sparse,
    /// In no order.
    Shuffled,
}

pub(super) const SPARSE_STRIDE: u32 = 61;

impl Numbering {
    fn loc(self, token: u32) -> Loc {
        let mixed = token.wrapping_mul(0x9E37_79B1);
        let start = match self {
            Numbering::Dense => token,
            Numbering::Sparse => token * SPARSE_STRIDE + mixed % SPARSE_STRIDE,
            Numbering::Shuffled => mixed & 0x00FF_FFFF,
        };
        Loc { start: start as i32 }
    }
}

/// The node a token stands for.
#[derive(Copy, Clone)]
pub(super) enum Origin {
    Expr(ExprId),
    Stmt(StmtId),
    Decl(VarDeclId),
    Pat(PatId),
    Fn(FnId),
    Case(CaseId),
    Prop(PropId),
}

/// What `PendingCompile` and `maybe_compile_pending` take.
pub(super) struct Function {
    pub(super) args: StoreSlice<G::Arg>,
    pub(super) flags: flags::FunctionSet,
    pub(super) body: Vec<Stmt>,
    pub(super) body_loc: Loc,
}

/// Of one file.
pub(super) struct Adapter<'a, 'c, 'p, 's> {
    build: &'a mut FileBuild<'c, 'p, 's>,
    file: FileId,
    hir: &'p hir::File<'s>,
    bound: &'p Bound<'s>,
    arena: &'a Arena,
    pub(super) host: Host<'a>,
    numbering: Numbering,
    /// By token.
    origins: Vec<Origin>,
    /// With whether the visit pass refers to it by an `E::ImportIdentifier`.
    symbols: FxHashMap<SymbolId, (Ref, bool)>,
    unbound: FxHashMap<Atom, Ref>,
    labels: FxHashMap<Atom, Ref>,
    private_names: FxHashMap<Atom, Ref>,
}

fn leak<T>(items: Vec<T>) -> StoreSlice<T> {
    let items: AstVec<T> = AstAlloc::vec_from_iter(items);
    StoreSlice::new_mut(items.leak())
}

fn binary_op(op: BinOp) -> OpCode {
    match op {
        BinOp::Add => OpCode::BinAdd,
        BinOp::Sub => OpCode::BinSub,
        BinOp::Mul => OpCode::BinMul,
        BinOp::Div => OpCode::BinDiv,
        BinOp::Rem => OpCode::BinRem,
        BinOp::Pow => OpCode::BinPow,
        BinOp::Shl => OpCode::BinShl,
        BinOp::Shr => OpCode::BinShr,
        BinOp::UShr => OpCode::BinUShr,
        BinOp::BitAnd => OpCode::BinBitwiseAnd,
        BinOp::BitOr => OpCode::BinBitwiseOr,
        BinOp::BitXor => OpCode::BinBitwiseXor,
        BinOp::Lt => OpCode::BinLt,
        BinOp::Le => OpCode::BinLe,
        BinOp::Gt => OpCode::BinGt,
        BinOp::Ge => OpCode::BinGe,
        BinOp::EqEq => OpCode::BinLooseEq,
        BinOp::NotEq => OpCode::BinLooseNe,
        BinOp::EqEqEq => OpCode::BinStrictEq,
        BinOp::NotEqEq => OpCode::BinStrictNe,
        BinOp::In => OpCode::BinIn,
        BinOp::Instanceof => OpCode::BinInstanceof,
        BinOp::And => OpCode::BinLogicalAnd,
        BinOp::Or => OpCode::BinLogicalOr,
        BinOp::Nullish => OpCode::BinNullishCoalescing,
        BinOp::Comma => OpCode::BinComma,
    }
}

fn assign_op(op: Option<BinOp>) -> OpCode {
    match op {
        None => OpCode::BinAssign,
        Some(BinOp::Add) => OpCode::BinAddAssign,
        Some(BinOp::Sub) => OpCode::BinSubAssign,
        Some(BinOp::Mul) => OpCode::BinMulAssign,
        Some(BinOp::Div) => OpCode::BinDivAssign,
        Some(BinOp::Rem) => OpCode::BinRemAssign,
        Some(BinOp::Pow) => OpCode::BinPowAssign,
        Some(BinOp::Shl) => OpCode::BinShlAssign,
        Some(BinOp::Shr) => OpCode::BinShrAssign,
        Some(BinOp::UShr) => OpCode::BinUShrAssign,
        Some(BinOp::BitOr) => OpCode::BinBitwiseOrAssign,
        Some(BinOp::BitAnd) => OpCode::BinBitwiseAndAssign,
        Some(BinOp::BitXor) => OpCode::BinBitwiseXorAssign,
        Some(BinOp::Nullish) => OpCode::BinNullishCoalescingAssign,
        Some(BinOp::Or) => OpCode::BinLogicalOrAssign,
        Some(BinOp::And) => OpCode::BinLogicalAndAssign,
        // No such token.
        Some(_) => OpCode::BinAssign,
    }
}

fn unary_op(op: UnOp) -> OpCode {
    match op {
        UnOp::Plus => OpCode::UnPos,
        UnOp::Minus => OpCode::UnNeg,
        UnOp::BitNot => OpCode::UnCpl,
        UnOp::Not => OpCode::UnNot,
        UnOp::Typeof => OpCode::UnTypeof,
        UnOp::Void => OpCode::UnVoid,
        UnOp::Delete => OpCode::UnDelete,
        UnOp::PreInc => OpCode::UnPreInc,
        UnOp::PreDec => OpCode::UnPreDec,
        UnOp::PostInc => OpCode::UnPostInc,
        UnOp::PostDec => OpCode::UnPostDec,
    }
}

fn optional_chain(chain: Chain) -> Option<OptionalChain> {
    match chain {
        Chain::No => None,
        Chain::Start => Some(OptionalChain::Start),
        Chain::Continue => Some(OptionalChain::Continuation),
    }
}

/// The expression without the type syntax around it, which the parser drops.
pub(super) fn skip_casts(hir: &hir::File<'_>, mut e: ExprId) -> ExprId {
    loop {
        e = match hir[e].kind {
            ExprKind::As { expr, .. } | ExprKind::Satisfies { expr, .. } | ExprKind::Instantiation { expr, .. } => expr,
            ExprKind::AsConst(expr) | ExprKind::NonNull(expr) => expr,
            _ => return e,
        };
    }
}

/// The text of a directive, if the statement is written as one. Which statements are in a directive prologue is up to the caller.
fn directive(hir: &hir::File<'_>, stmt: StmtId) -> Option<Atom> {
    let StmtKind::Expr(e) = hir[stmt].kind else { return None };
    let ExprKind::String(text) = hir[e].kind else { return None };
    let is_quoted = matches!(hir.text.get(hir[e].pos as usize), Some(b'"' | b'\''));
    (is_quoted && !hir::is_parenthesized(hir, e)).then_some(text)
}

impl<'a, 'c, 'p, 's> Adapter<'a, 'c, 'p, 's> {
    pub(super) fn new(build: &'a mut FileBuild<'c, 'p, 's>, file: FileId, arena: &'a Arena, numbering: Numbering) -> Adapter<'a, 'c, 'p, 's> {
        let (hir, bound) = (build.hir(file), build.c.bound(file));
        let runtime = build.jsx_runtime(file);
        let is_jsx_dev = runtime.is_some_and(|runtime| build.c.atoms().bytes(runtime).ends_with(b"jsx-dev-runtime"));
        Adapter {
            build,
            file,
            hir,
            bound,
            arena,
            host: Host::new(arena, &hir.text, runtime.is_none(), is_jsx_dev),
            numbering,
            origins: Vec::new(),
            symbols: FxHashMap::default(),
            unbound: FxHashMap::default(),
            labels: FxHashMap::default(),
            private_names: FxHashMap::default(),
        }
    }

    /// Where the node of a token starts in the source.
    pub(super) fn pos(&self, token: u32) -> Option<u32> {
        let hir = self.hir;
        Some(match *self.origins.get(token as usize)? {
            Origin::Expr(e) => hir[e].pos,
            Origin::Stmt(stmt) => hir[stmt].start,
            Origin::Decl(decl) => hir[hir[decl].pat].pos,
            Origin::Pat(pat) => hir[pat].pos,
            Origin::Fn(func) => hir[func].start,
            Origin::Case(case) => hir[case].pos,
            Origin::Prop(prop) => hir[prop].pos,
        })
    }

    fn loc(&mut self, origin: Origin) -> Loc {
        let token = self.origins.len() as u32;
        self.origins.push(origin);
        self.numbering.loc(token)
    }

    fn text(&self, atom: Atom) -> &'p [u8] {
        let bytes = self.build.c.atoms().bytes(atom);
        bytes.strip_prefix(&[0xFE]).unwrap_or(bytes)
    }

    fn string(&self, text: &[u8]) -> E::EString {
        E::EString::init_re_encode_utf8(self.arena.alloc_slice_copy(text), self.arena)
    }

    // ───────────────────────────── symbols ─────────────────────────────

    /// What `collect_import_bindings` makes of the `S::Import`s of a module.
    pub(super) fn import_bindings(&mut self) -> IndexMap<Ref, VariableBinding> {
        let (hir, bound) = (self.hir, self.bound);
        let mut bindings = Vec::new();
        for import in hir.imports.iter().filter(|import| !import.type_only) {
            let module = StoreStr::new(self.text(import.spec));
            let mut bind = |adapter: &mut Self, local: Atom, imported: Option<&[u8]>| {
                let Some(symbol) = bound.lookup(bound.scopes[0].locals, local) else { return };
                let name = StoreStr::new(adapter.text(local));
                let binding = match imported {
                    None => VariableBinding::ImportNamespace { name, module },
                    Some(b"default") => VariableBinding::ImportDefault { name, module },
                    Some(imported) => VariableBinding::ImportSpecifier { name, module, imported: StoreStr::new(imported) },
                };
                bindings.push((adapter.symbol(symbol).0, binding));
            };
            if import.namespace.is_some() {
                bind(self, import.namespace, None);
            }
            if import.default.is_some() {
                bind(self, import.default, Some(b"default"));
            }
            for spec in import.named.iter().map(|spec| &hir[spec]).filter(|spec| !spec.type_only) {
                let imported = self.text(spec.imported);
                bind(self, spec.local, Some(imported));
            }
        }
        bindings.into_iter().collect()
    }

    /// The variable declaration a name of a binding pattern belongs to.
    fn var_kind(&self, pat: PatId) -> Option<VarKind> {
        let mut root = pat;
        loop {
            match self.bound.pat_parent[root.idx()] {
                PatParent::Prop(outer, _) | PatParent::Elem(outer, _) => root = outer,
                PatParent::Var(decl) => return Some(self.hir[decl].kind),
                PatParent::Param(_) | PatParent::None => return None,
            }
        }
    }

    fn is_declared_in_function(&self, decl: Decl) -> bool {
        if matches!(decl, Decl::Fn(func) if self.hir[func].kind != FnKind::Decl) {
            return true;
        }
        let mut scope = self.bound.scope_of_declaration(self.hir, decl);
        while let Some(at) = self.bound.scopes.get(scope.idx()) {
            if matches!(at.kind, ScopeKind::Fn(_)) {
                return true;
            }
            scope = at.parent;
        }
        false
    }

    /// The symbol of the parser for a symbol of the binder.
    fn symbol(&mut self, symbol: SymbolId) -> (Ref, bool) {
        if let Some(&known) = self.symbols.get(&symbol) {
            return known;
        }
        let (hir, bound) = (self.hir, self.bound);
        let declared = &bound.symbols[symbol.idx()];
        let decls = declared.decls.as_slice();
        let decl = decls.get(declared.value_declaration as usize).or(decls.first()).copied();
        let kind = match decl {
            Some(Decl::Var(pat) | Decl::Require(pat)) => match self.var_kind(pat) {
                Some(VarKind::Var) => symbol::Kind::Hoisted,
                Some(VarKind::Const | VarKind::Using | VarKind::AwaitUsing) => symbol::Kind::Constant,
                Some(VarKind::Let) | None => symbol::Kind::Other,
            },
            Some(Decl::Param(_)) => symbol::Kind::Hoisted,
            Some(Decl::Fn(func)) if hir[func].flags.intersects(Flags::ASYNC | Flags::GENERATOR) => symbol::Kind::GeneratorOrAsyncFunction,
            Some(Decl::Fn(_)) => symbol::Kind::HoistedFunction,
            Some(Decl::Class(_)) => symbol::Kind::Class,
            Some(Decl::Enum(_)) => symbol::Kind::TsEnum,
            Some(Decl::Module(_)) => symbol::Kind::TsNamespace,
            Some(Decl::ImportDefault(_) | Decl::ImportNamespace(_) | Decl::ImportSpec(_)) => symbol::Kind::Import,
            _ => symbol::Kind::Other,
        };
        let name = self.text(declared.name);
        let ref_ = self.host.new_symbol(kind, name);
        if kind != symbol::Kind::Import && decl.is_some_and(|decl| !self.is_declared_in_function(decl)) {
            self.host.declare_in_module(ref_);
        }
        let known = (ref_, matches!(decl, Some(Decl::ImportDefault(_) | Decl::ImportSpec(_))));
        self.symbols.insert(symbol, known);
        known
    }

    fn unbound(&mut self, name: Atom) -> Ref {
        if let Some(&known) = self.unbound.get(&name) {
            return known;
        }
        let text = self.text(name);
        let ref_ = self.host.new_symbol(symbol::Kind::Unbound, text);
        self.unbound.insert(name, ref_);
        ref_
    }

    fn label(&mut self, name: Atom, loc: Loc) -> LocRef {
        if let Some(&ref_) = self.labels.get(&name) {
            return LocRef { loc, ref_ };
        }
        let text = self.text(name);
        let ref_ = self.host.new_symbol(symbol::Kind::Label, text);
        self.labels.insert(name, ref_);
        LocRef { loc, ref_ }
    }

    fn private_name(&mut self, name: Atom) -> Ref {
        if let Some(&known) = self.private_names.get(&name) {
            return known;
        }
        let text = self.text(name);
        let ref_ = self.host.new_symbol(symbol::Kind::PrivateField, text);
        self.private_names.insert(name, ref_);
        ref_
    }

    fn reference(&mut self, symbol: SymbolId, loc: Loc) -> Expr {
        match self.symbol(symbol) {
            (ref_, true) => Expr::init(E::ImportIdentifier::new(ref_, true), loc),
            (ref_, false) => Expr::init_identifier(ref_, loc),
        }
    }

    fn identifier(&mut self, e: ExprId, name: Atom, loc: Loc, is_target: bool) -> Expr {
        match self.build.c.resolve_identifier(self.file, e, name, true) {
            Ok(Some(found)) if found.file == self.file => return self.reference(found.id, loc),
            _ => {}
        }
        if !is_target {
            match self.text(name) {
                b"undefined" => return Expr::init(E::Undefined {}, loc),
                b"NaN" => return Expr::init(E::Number::new(f64::NAN), loc),
                b"Infinity" => return Expr::init(E::Number::new(f64::INFINITY), loc),
                _ => {}
            }
        }
        Expr::init_identifier(self.unbound(name), loc)
    }

    // ───────────────────────────── expressions ─────────────────────────────

    fn constant(&self, constant: &Constant, loc: Loc) -> Expr {
        match constant {
            Constant::Undefined => Expr::init(E::Undefined {}, loc),
            Constant::Null => Expr::init(E::Null {}, loc),
            Constant::Bool(value) => Expr::init(E::Boolean { value: *value }, loc),
            Constant::Number(value) => Expr::init(E::Number::new(*value), loc),
            Constant::String(value) => Expr::init(self.string(value), loc),
            Constant::Object(members) => {
                let mut properties: G::PropertyList = AstAlloc::vec_with_capacity(members.len());
                for (name, value) in members {
                    let key = Expr::init(self.string(name), loc);
                    properties.push(G::Property { key: Some(key), value: Some(self.constant(value, loc)), ..Default::default() });
                }
                Expr::init(E::Object { properties, ..Default::default() }, loc)
            }
            Constant::Array(elements) => {
                let mut items: ExprNodeList = AstAlloc::vec_with_capacity(elements.len());
                for element in elements {
                    items.push(self.constant(element, loc));
                }
                Expr::init(E::Array { items, ..Default::default() }, loc)
            }
        }
    }

    fn optional_expr(&mut self, e: ExprId) -> Option<Expr> {
        e.is_some().then(|| self.expr(e))
    }

    fn exprs(&mut self, list: IdList<ExprId>, is_target: bool) -> ExprNodeList {
        let hir = self.hir;
        let mut items: ExprNodeList = AstAlloc::vec_with_capacity(list.len());
        for e in hir.ids(list) {
            items.push(self.convert(e, is_target));
        }
        items
    }

    fn expr(&mut self, e: ExprId) -> Expr {
        self.convert(e, false)
    }

    /// `is_target`: it is assigned to, or part of a pattern that is.
    fn convert(&mut self, e: ExprId, is_target: bool) -> Expr {
        let hir = self.hir;
        let kind = hir[e].kind;
        match kind {
            ExprKind::As { expr, .. } | ExprKind::Satisfies { expr, .. } | ExprKind::Instantiation { expr, .. } => return self.convert(expr, is_target),
            ExprKind::AsConst(expr) | ExprKind::NonNull(expr) => return self.convert(expr, is_target),
            ExprKind::Binary { .. } => return self.binary(e),
            // As `e_if` of the visit pass.
            ExprKind::Cond { test, yes, no } => {
                if let Some(known) = self.build.constant_in(self.file, test) {
                    return self.expr(if known.is_truthy() { yes } else { no });
                }
            }
            _ => {}
        }
        let loc = self.loc(Origin::Expr(e));
        let is_replaced = match kind {
            ExprKind::Ident(_) | ExprKind::Dot { .. } | ExprKind::Call(_) => !is_target,
            ExprKind::Unary { op, .. } => op == UnOp::Not,
            _ => false,
        };
        if is_replaced && let Some(known) = self.build.constant_in(self.file, e) {
            return self.constant(&known, loc);
        }
        match kind {
            ExprKind::Missing => Expr::init(E::Missing {}, loc),
            ExprKind::Ident(name) => self.identifier(e, name, loc, is_target),
            ExprKind::PrivateIdentifier(name) => Expr::init(E::PrivateIdentifier { ref_: self.private_name(name) }, loc),
            ExprKind::This => Expr::init(E::This {}, loc),
            ExprKind::Super => Expr::init(E::Super {}, loc),
            ExprKind::Null => Expr::init(E::Null {}, loc),
            ExprKind::True => Expr::init(E::Boolean { value: true }, loc),
            ExprKind::False => Expr::init(E::Boolean { value: false }, loc),
            ExprKind::Number(index) => Expr::init(E::Number::new(hir.numbers[index as usize]), loc),
            ExprKind::String(value) => Expr::init(self.string(self.text(value)), loc),
            ExprKind::BigInt(value) => Expr::init(E::BigInt { value: StoreStr::new(self.text(value)) }, loc),
            ExprKind::Regex => {
                let text = &hir.text[hir[e].pos as usize..hir[e].end as usize];
                let flags = text.iter().rposition(|&byte| byte == b'/').map_or(text.len(), |slash| slash + 1);
                let flags_offset = if flags < text.len() { u16::try_from(flags).ok() } else { None };
                Expr::init(E::RegExp { value: StoreStr::new(text), flags_offset }, loc)
            }
            ExprKind::Template { exprs } => {
                let mut texts = hir.ids(hir.template_texts(exprs));
                let mut cooked = |adapter: &Self| E::TemplateContents::Cooked(adapter.string(texts.next().map_or(&[][..], |text: Atom| adapter.text(text))));
                let head = cooked(self);
                let mut parts = Vec::with_capacity(exprs.len());
                for value in hir.ids(exprs) {
                    parts.push(E::TemplatePart { value: self.expr(value), tail_loc: Loc::EMPTY, tail: cooked(self) });
                }
                Expr::init(E::Template { tag: None, parts: leak(parts), head }, loc)
            }
            ExprKind::TaggedTemplate(call) => self.tagged_template(call, loc),
            ExprKind::Array(items) => Expr::init(E::Array { items: self.exprs(items, is_target), ..Default::default() }, loc),
            ExprKind::Object(props) => Expr::init(E::Object { properties: self.props(props, is_target), ..Default::default() }, loc),
            ExprKind::Fn(func) => self.function_expr(func, loc),
            ExprKind::Class(_) => Expr::init(E::Class::default(), loc),
            ExprKind::Dot { obj, name, chain, .. } => {
                let target = self.expr(obj);
                let (text, optional_chain) = (self.text(name), optional_chain(chain));
                if text.starts_with(b"#") {
                    let index = Expr::init(E::PrivateIdentifier { ref_: self.private_name(name) }, loc);
                    return Expr::init(E::Index { index, target, optional_chain, is_import_property_use: false }, loc);
                }
                Expr::init(E::Dot { target, name: StoreStr::new(text), name_loc: loc, optional_chain, ..Default::default() }, loc)
            }
            ExprKind::Index { obj, index, chain } => {
                let target = self.expr(obj);
                let index = self.expr(index);
                Expr::init(E::Index { index, target, optional_chain: optional_chain(chain), is_import_property_use: false }, loc)
            }
            ExprKind::Call(call) => {
                let target = self.expr(hir[call].callee);
                let args = self.exprs(hir[call].args, false);
                Expr::init(E::Call { target, args, optional_chain: optional_chain(hir[call].chain), ..Default::default() }, loc)
            }
            ExprKind::New(call) => {
                let target = self.expr(hir[call].callee);
                let args = self.exprs(hir[call].args, false);
                Expr::init(E::New { target, args, ..Default::default() }, loc)
            }
            ExprKind::Unary { op, operand } => {
                let is_written = matches!(op, UnOp::Delete | UnOp::PreInc | UnOp::PreDec | UnOp::PostInc | UnOp::PostDec);
                let flags = match (op, hir[skip_casts(hir, operand)].kind) {
                    (UnOp::Typeof, ExprKind::Ident(_)) => E::UnaryFlags::WAS_ORIGINALLY_TYPEOF_IDENTIFIER,
                    (UnOp::Delete, ExprKind::Ident(_) | ExprKind::Dot { .. } | ExprKind::Index { .. }) => E::UnaryFlags::WAS_ORIGINALLY_DELETE_OF_IDENTIFIER_OR_PROPERTY_ACCESS,
                    _ => E::UnaryFlags::empty(),
                };
                Expr::init(E::Unary { op: unary_op(op), value: self.convert(operand, is_written), flags }, loc)
            }
            ExprKind::Assign { op, target, value } => {
                let left = self.convert(target, true);
                let right = self.expr(value);
                Expr::init(E::Binary { left, right, op: assign_op(op) }, loc)
            }
            ExprKind::Cond { test, yes, no } => {
                let test = self.expr(test);
                let yes = self.expr(yes);
                let no = self.expr(no);
                Expr::init(E::If { test, yes, no }, loc)
            }
            ExprKind::Spread(value) => Expr::init(E::Spread { value: self.convert(value, is_target) }, loc),
            ExprKind::Await(value) => Expr::init(E::Await { value: self.expr(value) }, loc),
            ExprKind::Yield { value, star } => Expr::init(E::Yield { value: self.optional_expr(value), is_star: star }, loc),
            ExprKind::Jsx(jsx) => self.jsx(e, jsx, loc),
            ExprKind::ImportCall { args } => {
                let mut args = hir.ids(args);
                let expr = args.next().map_or(Expr::EMPTY, |specifier| self.expr(specifier));
                let options = args.next().map_or(Expr::EMPTY, |options| self.expr(options));
                Expr::init(E::Import { expr, options, import_record_index: u32::MAX, namespace_ref: Ref::NONE }, loc)
            }
            ExprKind::ImportMeta => Expr::init(E::ImportMeta {}, loc),
            ExprKind::NewTarget(_) => Expr::init(E::NewTarget { range: Range::NONE }, loc),
            ExprKind::Binary { .. } | ExprKind::As { .. } | ExprKind::Satisfies { .. } | ExprKind::AsConst(_) | ExprKind::NonNull(_) | ExprKind::Instantiation { .. } => {
                unreachable!("handled above")
            }
        }
    }

    /// Not recursive on the left: `a + b + ...` is as deep as it is long.
    fn binary(&mut self, e: ExprId) -> Expr {
        let hir = self.hir;
        let mut spine: Vec<(Loc, BinOp, ExprId)> = Vec::new();
        let mut at = e;
        let mut value = loop {
            let ExprKind::Binary { op, left, right } = hir[at].kind else { break self.expr(at) };
            match op {
                BinOp::And | BinOp::Or | BinOp::Nullish => {
                    if let Some(known) = self.build.constant_in(self.file, left) {
                        let takes_right = match op {
                            BinOp::And => known.is_truthy(),
                            BinOp::Or => !known.is_truthy(),
                            _ => matches!(known, Constant::Undefined | Constant::Null),
                        };
                        if takes_right {
                            break self.expr(right);
                        }
                        let loc = self.loc(Origin::Expr(left));
                        break self.constant(&known, loc);
                    }
                }
                BinOp::EqEq | BinOp::NotEq | BinOp::EqEqEq | BinOp::NotEqEq => {
                    if let Some(known) = self.build.constant_in(self.file, at) {
                        let loc = self.loc(Origin::Expr(at));
                        break self.constant(&known, loc);
                    }
                }
                _ => {}
            }
            spine.push((self.loc(Origin::Expr(at)), op, right));
            at = left;
        };
        while let Some((loc, op, right)) = spine.pop() {
            let right = self.expr(right);
            value = Expr::init(E::Binary { left: value, right, op: binary_op(op) }, loc);
        }
        value
    }

    fn tagged_template(&mut self, call: CallId, loc: Loc) -> Expr {
        let hir = self.hir;
        let tag = self.expr(hir[call].callee);
        let template = &hir[hir[call].template];
        let raw = hir.text.get(template.pos as usize + 1..(template.end as usize).saturating_sub(1)).unwrap_or_default();
        let mut parts = Vec::with_capacity(hir[call].args.len());
        for value in hir.ids(hir[call].args) {
            parts.push(E::TemplatePart { value: self.expr(value), tail_loc: Loc::EMPTY, tail: E::TemplateContents::Raw(StoreStr::EMPTY) });
        }
        Expr::init(E::Template { tag: Some(tag), parts: leak(parts), head: E::TemplateContents::Raw(StoreStr::new(raw)) }, loc)
    }

    /// The name of a member of an object literal or of a binding pattern, and whether it is computed.
    fn key(&mut self, key: PropKey, name_kind: NameKind, loc: Loc) -> (Expr, bool) {
        match key {
            PropKey::Name(name) => {
                let text = self.text(name);
                let number = match name_kind {
                    NameKind::NumericLiteral | NameKind::ComputedNumber => std::str::from_utf8(text).ok().and_then(|text| text.parse::<f64>().ok()),
                    _ => None,
                };
                let is_computed = matches!(name_kind, NameKind::ComputedString | NameKind::ComputedNumber);
                match number {
                    Some(number) => (Expr::init(E::Number::new(number), loc), is_computed),
                    None => (Expr::init(self.string(text), loc), is_computed),
                }
            }
            PropKey::Computed(e) => (self.expr(e), true),
            PropKey::Private(name) => (Expr::init(E::PrivateIdentifier { ref_: self.private_name(name) }, loc), false),
            PropKey::None => (Expr::init(E::Missing {}, loc), false),
        }
    }

    fn props(&mut self, props: Span<PropId>, is_target: bool) -> G::PropertyList {
        let hir = self.hir;
        let mut properties: G::PropertyList = AstAlloc::vec_with_capacity(props.len());
        for id in props.iter() {
            let prop = &hir[id];
            if prop.kind == PropKind::Spread {
                properties.push(G::Property { kind: G::PropertyKind::Spread, value: Some(self.convert(prop.value, is_target)), ..Default::default() });
                continue;
            }
            let loc = self.loc(Origin::Prop(id));
            let (key, is_computed) = self.key(prop.key, prop.name_kind, loc);
            let mut flags = flags::PROPERTY_NONE;
            if is_computed {
                flags.insert(flags::Property::IsComputed);
            }
            let mut property = G::Property { key: Some(key), ..Default::default() };
            match prop.kind {
                PropKind::Getter => property.kind = G::PropertyKind::Get,
                PropKind::Setter => property.kind = G::PropertyKind::Set,
                PropKind::Method => {
                    flags.insert(flags::Property::IsMethod);
                }
                PropKind::Shorthand => {
                    flags.insert(flags::Property::WasShorthand);
                }
                PropKind::Init | PropKind::Spread => {}
            }
            property.flags = flags;
            // `{ a = 1 }`, in a pattern.
            match hir[prop.value].kind {
                ExprKind::Assign { op: None, target, value } if prop.kind == PropKind::Shorthand => {
                    property.value = Some(self.convert(target, is_target));
                    property.initializer = Some(self.expr(value));
                }
                _ => property.value = Some(self.convert(prop.value, is_target)),
            }
            properties.push(property);
        }
        properties
    }

    // ───────────────────────────── JSX ─────────────────────────────

    fn jsx_import(&mut self, kind: JsxImportKind, loc: Loc) -> Expr {
        Expr::init(E::ImportIdentifier::new(self.host.jsx_import(kind), true), loc)
    }

    /// `React.createElement`, `React.Fragment`, or what the file names instead.
    fn classic_jsx_entity(&mut self, e: ExprId, is_fragment_tag: bool) -> Expr {
        let (entity, found) = self.build.c.classic_jsx_factory(self.file, e, is_fragment_tag);
        let loc = self.loc(Origin::Expr(e));
        let mut value = match found {
            Some(found) if found.file == self.file => self.reference(found.id, loc),
            _ => Expr::init_identifier(self.unbound(entity[0]), loc),
        };
        for &name in &entity[1..] {
            value = Expr::init(E::Dot { target: value, name: StoreStr::new(self.text(name)), name_loc: loc, ..Default::default() }, loc);
        }
        value
    }

    fn jsx_tag(&mut self, e: ExprId, tag: ExprId) -> Expr {
        let hir = self.hir;
        if tag.is_none() {
            if self.host.is_jsx_classic() {
                return self.classic_jsx_entity(e, true);
            }
            let loc = self.loc(Origin::Expr(e));
            return self.jsx_import(JsxImportKind::Fragment, loc);
        }
        match hir[tag].kind {
            ExprKind::Ident(name) if hir::is_intrinsic_jsx_name(self.text(name)) => {
                let loc = self.loc(Origin::Expr(tag));
                Expr::init(self.string(self.text(name)), loc)
            }
            _ => self.expr(tag),
        }
    }

    /// As `e_jsx_element` of the visit pass.
    fn jsx(&mut self, e: ExprId, jsx: JsxId, loc: Loc) -> Expr {
        let hir = self.hir;
        let element = &hir[jsx];
        let is_classic = self.host.is_jsx_classic();
        let has_value = |attr: &hir::Prop| attr.value.is_some() && !matches!(hir[attr.value].kind, ExprKind::Missing);
        let is_key = |adapter: &Self, attr: &hir::Prop| matches!(attr.key, PropKey::Name(name) if adapter.text(name) == b"key") && attr.kind != PropKind::Spread;
        // The parser drops a `key` without a value.
        let attrs: Vec<PropId> = element.attrs.iter().filter(|&id| !is_key(self, &hir[id]) || has_value(&hir[id])).collect();
        let key_index = attrs.iter().rposition(|&id| is_key(self, &hir[id]));
        let first_spread = attrs.iter().position(|&id| hir[id].kind == PropKind::Spread);
        let is_key_after_spread = matches!((key_index, first_spread), (Some(key), Some(spread)) if key > spread);
        let calls_create_element = is_classic || is_key_after_spread;

        let callee_loc = self.loc(Origin::Expr(e));
        let tag = self.jsx_tag(e, element.tag);

        let mut key = None;
        let mut properties: G::PropertyList = AstAlloc::vec_with_capacity(attrs.len() + 1);
        for (index, &id) in attrs.iter().enumerate() {
            let attr = &hir[id];
            if attr.kind == PropKind::Spread {
                properties.push(G::Property { kind: G::PropertyKind::Spread, value: Some(self.expr(attr.value)), ..Default::default() });
                continue;
            }
            let PropKey::Name(name) = attr.key else { continue };
            let name_loc = self.loc(Origin::Prop(id));
            let value = if has_value(attr) { self.expr(attr.value) } else { Expr::init(E::Boolean { value: true }, name_loc) };
            if Some(index) == key_index && !calls_create_element {
                key = Some(value);
                continue;
            }
            properties.push(G::Property { key: Some(Expr::init(self.string(self.text(name)), name_loc)), value: Some(value), ..Default::default() });
        }

        let mut children: ExprNodeList = AstAlloc::vec_with_capacity(element.children.len());
        for child in hir.ids(element.children) {
            match hir[child].kind {
                ExprKind::Missing => {}
                ExprKind::String(_) if hir::jsx_expression_around(hir, child).is_none() => {
                    let text = jsx_text(&hir.text[hir[child].pos as usize..hir[child].end as usize]);
                    if !text.is_empty() {
                        let loc = self.loc(Origin::Expr(child));
                        children.push(Expr::init(self.string(&text), loc));
                    }
                }
                _ => children.push(self.expr(child)),
            }
        }
        let close_paren_loc = self.loc(Origin::Expr(e));

        if calls_create_element {
            let target = if is_classic {
                let factory = self.classic_jsx_entity(e, false);
                self.host.classic_factory = factory;
                factory
            } else {
                self.jsx_import(JsxImportKind::CreateElement, callee_loc)
            };
            let props = if properties.is_empty() { Expr::init(E::Null {}, loc) } else { Expr::init(E::Object { properties, ..Default::default() }, loc) };
            let mut args: ExprNodeList = AstAlloc::vec_with_capacity(2 + children.len());
            args.push(tag);
            args.push(props);
            args.extend(children);
            return Expr::init(E::Call { target, args, was_jsx_element: true, close_paren_loc, ..Default::default() }, loc);
        }

        // `<a {...{ b }} />` is `<a b={b} />`.
        while let [G::Property { kind: G::PropertyKind::Spread, value: Some(Expr { data: bun_ast::ExprData::EObject(inner), .. }), .. }] = properties.as_mut_slice() {
            properties = AstAlloc::take(&mut inner.properties);
        }

        let is_static = children.len() > 1 || matches!(children.first(), Some(Expr { data: bun_ast::ExprData::ESpread(_), .. }));
        if !children.is_empty() {
            let value = if is_static { Expr::init(E::Array { items: children, ..Default::default() }, close_paren_loc) } else { children[0] };
            properties.push(G::Property { key: Some(Expr::init(E::EString::init(b"children"), loc)), value: Some(value), ..Default::default() });
        }

        let is_dev = self.host.is_jsx_dev();
        let mut args: ExprNodeList = AstAlloc::vec_with_capacity(if is_dev { 6 } else { 3 });
        args.push(tag);
        args.push(Expr::init(E::Object { properties, ..Default::default() }, loc));
        match key {
            Some(key) => args.push(key),
            None if is_dev => args.push(Expr::init(E::Undefined {}, loc)),
            None => {}
        }
        if is_dev {
            args.push(Expr::init(E::Boolean { value: is_static }, loc));
            args.push(Expr::init(E::Undefined {}, loc));
            args.push(Expr::init(E::This {}, loc));
        }
        let kind = if is_dev {
            JsxImportKind::JsxDEV
        } else if is_static {
            JsxImportKind::Jsxs
        } else {
            JsxImportKind::Jsx
        };
        let target = self.jsx_import(kind, callee_loc);
        Expr::init(E::Call { target, args, was_jsx_element: true, close_paren_loc, ..Default::default() }, loc)
    }

    // ───────────────────────────── patterns ─────────────────────────────

    fn pat(&mut self, pat: PatId) -> Binding {
        let hir = self.hir;
        let loc = self.loc(Origin::Pat(pat));
        match hir[pat].kind {
            PatKind::Missing => Binding::alloc(self.arena, b::Missing {}, loc),
            PatKind::Ident(name) => {
                let r#ref = match self.bound.pat_symbol[pat.idx()].some() {
                    Some(symbol) => self.symbol(symbol).0,
                    None => self.unbound(name),
                };
                Binding::alloc(self.arena, b::Identifier { r#ref }, loc)
            }
            PatKind::Array(elems) => {
                let mut items = Vec::with_capacity(elems.len());
                let mut has_spread = false;
                for elem in elems.iter().map(|elem| &hir[elem]) {
                    has_spread = elem.is_rest;
                    let binding = self.pat(elem.pat);
                    items.push(ArrayBinding { binding, default_value: self.optional_expr(elem.default) });
                }
                Binding::alloc(self.arena, b::Array { items: leak(items), has_spread, is_single_line: false }, loc)
            }
            PatKind::Object(props) => {
                let mut properties = Vec::with_capacity(props.len());
                for prop in props.iter().map(|prop| &hir[prop]) {
                    let mut flags = flags::PROPERTY_NONE;
                    let key = match (prop.key, hir[prop.value].kind) {
                        _ if prop.is_rest => {
                            flags.insert(flags::Property::IsSpread);
                            Expr::init(E::Missing {}, loc)
                        }
                        // `{ a }`
                        (PropKey::None, PatKind::Ident(name)) => Expr::init(self.string(self.text(name)), loc),
                        (key, _) => {
                            let (key, is_computed) = self.key(key, prop.name_kind, loc);
                            if is_computed {
                                flags.insert(flags::Property::IsComputed);
                            }
                            key
                        }
                    };
                    let value = self.pat(prop.value);
                    properties.push(b::Property { flags, key, value, default_value: self.optional_expr(prop.default) });
                }
                Binding::alloc(self.arena, b::Object { properties: leak(properties), is_single_line: false }, loc)
            }
        }
    }

    // ───────────────────────────── functions ─────────────────────────────

    fn args(&mut self, func: FnId) -> (StoreSlice<G::Arg>, bool) {
        let hir = self.hir;
        let mut args = Vec::with_capacity(hir[func].params.len());
        let mut has_rest_arg = false;
        for param in hir[func].params.iter().map(|param| &hir[param]) {
            has_rest_arg = param.flags.contains(Flags::REST);
            let binding = self.pat(param.pat);
            args.push(G::Arg { binding, default: self.optional_expr(param.default), ..Default::default() });
        }
        (leak(args), has_rest_arg)
    }

    fn body(&mut self, func: FnId) -> Vec<Stmt> {
        match self.hir[func].body {
            FnBody::None => Vec::new(),
            FnBody::Block(list) => self.stmts(list, true),
            FnBody::Expr(e) => {
                let loc = self.loc(Origin::Expr(e));
                vec![Stmt::alloc(S::Return { value: Some(self.expr(e)) }, loc)]
            }
        }
    }

    /// A function that is handed to the compiler by itself.
    pub(super) fn function(&mut self, func: FnId) -> Function {
        let declared = self.hir[func].flags;
        let body_loc = self.loc(Origin::Fn(func));
        let (args, has_rest_arg) = self.args(func);
        let mut flags = flags::FUNCTION_NONE;
        for (flag, is_set) in [
            (flags::Function::IsAsync, declared.contains(Flags::ASYNC)),
            (flags::Function::IsGenerator, declared.contains(Flags::GENERATOR)),
            (flags::Function::HasRestArg, has_rest_arg),
            (flags::Function::HasReactHooksSuppression, declared.contains(Flags::REACT_HOOKS_SUPPRESSION)),
        ] {
            if is_set {
                flags.insert(flag);
            }
        }
        Function { args, flags, body: self.body(func), body_loc }
    }

    fn g_fn(&mut self, func: FnId) -> G::Fn {
        let hir = self.hir;
        let declared = &hir[func];
        let is_named = declared.name.is_some() && matches!(declared.kind, FnKind::Decl | FnKind::Expr);
        let name = match self.bound.fn_symbol[func.idx()].some() {
            Some(symbol) if is_named => Some(LocRef { loc: self.loc(Origin::Fn(func)), ref_: self.symbol(symbol).0 }),
            _ => None,
        };
        let Function { args, flags, body, body_loc } = self.function(func);
        G::Fn { name, open_parens_loc: body_loc, args, body: G::FnBody { loc: body_loc, stmts: leak(body) }, flags, ..Default::default() }
    }

    fn function_expr(&mut self, func: FnId, loc: Loc) -> Expr {
        if self.hir[func].kind != FnKind::Arrow {
            return Expr::init(E::Function { func: self.g_fn(func) }, loc);
        }
        let Function { args, flags, body, body_loc } = self.function(func);
        Expr::init(
            E::Arrow {
                args,
                body: G::FnBody { loc: body_loc, stmts: leak(body) },
                is_async: flags.contains(flags::Function::IsAsync),
                has_rest_arg: flags.contains(flags::Function::HasRestArg),
                prefer_expr: matches!(self.hir[func].body, FnBody::Expr(_)),
                has_react_hooks_suppression: flags.contains(flags::Function::HasReactHooksSuppression),
            },
            loc,
        )
    }

    // ───────────────────────────── statements ─────────────────────────────

    /// The directive prologue of a list of statements.
    pub(super) fn directives(&mut self, list: IdList<StmtId>) -> Vec<Stmt> {
        let hir = self.hir;
        let mut out = Vec::new();
        for stmt in hir.ids(list) {
            let Some(text) = directive(hir, stmt) else { break };
            let loc = self.loc(Origin::Stmt(stmt));
            out.push(Stmt::alloc(S::Directive { value: StoreStr::new(self.text(text)) }, loc));
        }
        out
    }

    fn stmts(&mut self, list: IdList<StmtId>, has_directives: bool) -> Vec<Stmt> {
        let hir = self.hir;
        let mut out = if has_directives { self.directives(list) } else { Vec::new() };
        for stmt in hir.ids(list).skip(out.len()) {
            self.stmt_into(stmt, &mut out);
        }
        out
    }

    fn block(&mut self, stmt: StmtId) -> (Loc, StmtNodeList) {
        let loc = self.loc(Origin::Stmt(stmt));
        let stmts = match self.hir[stmt].kind {
            StmtKind::Block(list) => self.stmts(list, false),
            _ => {
                let mut out = Vec::new();
                self.stmt_into(stmt, &mut out);
                out
            }
        };
        (loc, leak(stmts))
    }

    /// Where the syntax has one statement.
    fn stmt(&mut self, stmt: StmtId) -> Stmt {
        let mut out = Vec::new();
        self.stmt_into(stmt, &mut out);
        match out.len() {
            0 => Stmt::alloc(S::Empty {}, self.loc(Origin::Stmt(stmt))),
            1 => out[0],
            _ => Stmt::alloc(S::Block { stmts: leak(out), close_brace_loc: Loc::EMPTY }, self.loc(Origin::Stmt(stmt))),
        }
    }

    fn local_kind(kind: VarKind) -> S::Kind {
        match kind {
            VarKind::Var => S::Kind::KVar,
            VarKind::Let => S::Kind::KLet,
            VarKind::Const => S::Kind::KConst,
            VarKind::Using => S::Kind::KUsing,
            VarKind::AwaitUsing => S::Kind::KAwaitUsing,
        }
    }

    fn decl(&mut self, decl: VarDeclId) -> G::Decl {
        let hir = self.hir;
        let declared = &hir[decl];
        let binding = self.pat(declared.pat);
        G::Decl { binding, value: self.optional_expr(declared.init) }
    }

    /// The head of a loop: all declarations in one statement, or an expression.
    fn loop_head(&mut self, stmt: StmtId, is_target: bool) -> Stmt {
        let hir = self.hir;
        let loc = self.loc(Origin::Stmt(stmt));
        match hir[stmt].kind {
            StmtKind::Var(decls) => {
                let kind = decls.iter().next().map_or(S::Kind::KVar, |first| Self::local_kind(hir[first].kind));
                let mut list: G::DeclList = AstAlloc::vec_with_capacity(decls.len());
                for decl in decls.iter() {
                    list.push(self.decl(decl));
                }
                Stmt::alloc(S::Local { kind, decls: list, ..Default::default() }, loc)
            }
            StmtKind::Expr(e) => Stmt::alloc(S::SExpr { value: self.convert(e, is_target), ..Default::default() }, loc),
            _ => Stmt::alloc(S::Empty {}, loc),
        }
    }

    /// `var name`, which is what is left in place of an enum or a namespace, before the closure that fills it.
    fn hoisted_object(&mut self, symbol: SymbolId, loc: Loc) -> Stmt {
        let binding = Binding::alloc(self.arena, b::Identifier { r#ref: self.symbol(symbol).0 }, loc);
        Stmt::alloc(S::Local { kind: S::Kind::KVar, decls: AstAlloc::vec_from_iter([G::Decl { binding, value: None }]), ..Default::default() }, loc)
    }

    fn stmt_into(&mut self, stmt: StmtId, out: &mut Vec<Stmt>) {
        let hir = self.hir;
        let kind = hir[stmt].kind;
        match kind {
            // One statement each: an instruction has the location of its statement.
            StmtKind::Var(decls) => {
                for id in decls.iter().filter(|&id| !hir[id].flags.contains(Flags::AMBIENT)) {
                    let loc = self.loc(Origin::Decl(id));
                    let decl = self.decl(id);
                    out.push(Stmt::alloc(S::Local { kind: Self::local_kind(hir[id].kind), decls: AstAlloc::vec_from_iter([decl]), ..Default::default() }, loc));
                }
                return;
            }
            // The branch that is taken stands for the statement.
            StmtKind::If { test, yes, no } => {
                if let Some(known) = self.build.constant_in(self.file, test) {
                    let taken = if known.is_truthy() { yes } else { no };
                    if taken.is_some() {
                        self.stmt_into(taken, out);
                    }
                    return;
                }
            }
            StmtKind::Empty | StmtKind::Interface(_) | StmtKind::TypeAlias(_) => return,
            StmtKind::Fn(func) if matches!(hir[func].body, FnBody::None) => return,
            StmtKind::Class(class) if hir[class].flags.contains(Flags::AMBIENT) => return,
            StmtKind::Enum(declared) if hir[declared].flags.contains(Flags::AMBIENT) => return,
            StmtKind::Module(module) if hir[module].flags.contains(Flags::AMBIENT) => return,
            _ => {}
        }
        let loc = self.loc(Origin::Stmt(stmt));
        out.push(match kind {
            StmtKind::Debugger => Stmt::alloc(S::Debugger {}, loc),
            StmtKind::Expr(e) => Stmt::alloc(S::SExpr { value: self.expr(e), ..Default::default() }, loc),
            StmtKind::Fn(func) => Stmt::alloc(S::Function { func: self.g_fn(func) }, loc),
            StmtKind::Class(class) => {
                let class_name = self.bound.class_symbol[class.idx()].some().map(|symbol| LocRef { loc, ref_: self.symbol(symbol).0 });
                Stmt::alloc(S::Class { class: G::Class { class_name, ..Default::default() }, is_export: false }, loc)
            }
            StmtKind::Enum(declared) => self.hoisted_object(self.bound.enum_symbol[declared.idx()], loc),
            StmtKind::Module(module) => self.hoisted_object(self.bound.module_symbol[module.idx()], loc),
            StmtKind::Return(value) => Stmt::alloc(S::Return { value: self.optional_expr(value) }, loc),
            StmtKind::If { test, yes, no } => {
                let test = self.expr(test);
                let yes = self.stmt(yes);
                let no = no.is_some().then(|| self.stmt(no));
                Stmt::alloc(S::If { test, yes, no }, loc)
            }
            StmtKind::For { init, test, update, body } => {
                let init = init.is_some().then(|| self.loop_head(init, false));
                let test = self.optional_expr(test);
                let update = self.optional_expr(update);
                Stmt::alloc(S::For { init, test, update, body: self.stmt(body) }, loc)
            }
            StmtKind::ForIn { left, expr, body } => {
                let init = self.loop_head(left, true);
                let value = self.expr(expr);
                Stmt::alloc(S::ForIn { init, value, body: self.stmt(body) }, loc)
            }
            StmtKind::ForOf { left, expr, body, is_await } => {
                let init = self.loop_head(left, true);
                let value = self.expr(expr);
                Stmt::alloc(S::ForOf { is_await, init, value, body: self.stmt(body) }, loc)
            }
            StmtKind::While { test, body } => {
                let test = self.expr(test);
                Stmt::alloc(S::While { test, body: self.stmt(body) }, loc)
            }
            StmtKind::DoWhile { body, test } => {
                let body = self.stmt(body);
                Stmt::alloc(S::DoWhile { body, test: self.expr(test) }, loc)
            }
            StmtKind::Block(list) => Stmt::alloc(S::Block { stmts: leak(self.stmts(list, false)), close_brace_loc: Loc::EMPTY }, loc),
            StmtKind::Switch { expr, cases } => {
                let test = self.expr(expr);
                let mut converted = Vec::with_capacity(cases.len());
                for id in cases.iter() {
                    let loc = self.loc(Origin::Case(id));
                    let value = self.optional_expr(hir[id].test);
                    converted.push(Case { loc, value, body: leak(self.stmts(hir[id].body, false)) });
                }
                Stmt::alloc(S::Switch { test, body_loc: loc, cases: leak(converted) }, loc)
            }
            StmtKind::Try { block, param, handler, finalizer } => {
                let (body_loc, body) = self.block(block);
                let catch = handler.is_some().then(|| {
                    let binding = param.is_some().then(|| self.pat(hir[param].pat));
                    let (body_loc, body) = self.block(handler);
                    Catch { loc: body_loc, binding, body, body_loc }
                });
                let finally = finalizer.is_some().then(|| {
                    let (loc, stmts) = self.block(finalizer);
                    Finally { loc, stmts }
                });
                Stmt::alloc(S::Try { body_loc, body, catch, finally }, loc)
            }
            StmtKind::Throw(value) => Stmt::alloc(S::Throw { value: self.expr(value) }, loc),
            StmtKind::Break(label) => Stmt::alloc(S::Break { label: label.is_some().then(|| self.label(label, loc)) }, loc),
            StmtKind::Continue(label) => Stmt::alloc(S::Continue { label: label.is_some().then(|| self.label(label, loc)) }, loc),
            StmtKind::Labeled { label, body } => {
                let name = self.label(label, loc);
                Stmt::alloc(S::Label { name, stmt: self.stmt(body) }, loc)
            }
            // Only at the top level of a module, which is not converted.
            StmtKind::Import(_)
            | StmtKind::ImportEquals(_)
            | StmtKind::ExportNamed(_)
            | StmtKind::ExportStar { .. }
            | StmtKind::ExportDefault(_)
            | StmtKind::ExportAssign(_)
            | StmtKind::ExportAsNamespace(_) => Stmt::alloc(S::Empty {}, loc),
            StmtKind::Var(_) | StmtKind::Empty | StmtKind::Interface(_) | StmtKind::TypeAlias(_) => unreachable!("handled above"),
        });
    }
}
