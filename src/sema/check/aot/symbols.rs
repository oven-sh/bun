use super::OnceLock;
use crate::atom::{Atom, SYMBOL_NAME_PREFIX, known};
use crate::bind::{AccessKind, Decl, Parent, PatParent, SymFlags, SymbolId};
use crate::check::Checker;
use crate::hir::{Chain, ExprId, ExprKind, ExprTag, File, FileKind, Flags, PatId, PatKind, PatPropId, PropKey, PropKind, StmtKind, UnOp, VarKind};
use crate::program::{FileId, Sym};
use crate::util::FxHashSet;

const MAX_REEXPORTS: u8 = 4;
const INTERNAL_MODULES: &[u8] = b"/$bun/js/internal/";

#[derive(Default)]
pub(super) struct Shared {
    escaped_builtin_exports: OnceLock<FxHashSet<FileId>>,
    names_module_graph: OnceLock<bool>,
}

fn skip_assertions(hir: &File, mut e: ExprId) -> ExprId {
    while let ExprKind::As { expr, .. } | ExprKind::Satisfies { expr, .. } | ExprKind::NonNull(expr) | ExprKind::AsConst(expr) = hir[e].kind {
        e = expr;
    }
    e
}

#[derive(Copy, Clone, PartialEq, Eq, Hash, Debug)]
pub enum WellKnownSymbol {
    AsyncDispose,
    Dispose,
}

impl WellKnownSymbol {
    fn named(name: &[u8]) -> Option<WellKnownSymbol> {
        match name {
            b"asyncDispose" => Some(WellKnownSymbol::AsyncDispose),
            b"dispose" => Some(WellKnownSymbol::Dispose),
            _ => None,
        }
    }

    fn name(self) -> &'static [u8] {
        match self {
            WellKnownSymbol::AsyncDispose => b"asyncDispose",
            WellKnownSymbol::Dispose => b"dispose",
        }
    }
}

#[derive(Copy, Clone, PartialEq, Eq, Hash, Debug)]
pub enum ConstantSymbol {
    Created { declaration: Sym, description: Option<Atom> },
    Registered(Atom),
    WellKnown(WellKnownSymbol),
}

#[derive(Copy, Clone, PartialEq, Eq, Hash)]
pub enum FieldKey {
    Name(Atom),
    Symbol(ConstantSymbol),
}

impl FieldKey {
    pub(super) fn order(self) -> (u8, u32, u32) {
        match self {
            FieldKey::Name(name) => (0, name.0, 0),
            FieldKey::Symbol(ConstantSymbol::WellKnown(symbol)) => (1, symbol as u32, 0),
            FieldKey::Symbol(ConstantSymbol::Registered(key)) => (2, key.0, 0),
            FieldKey::Symbol(ConstantSymbol::Created { declaration, .. }) => (3, declaration.file.0, declaration.id.0),
        }
    }
}

#[derive(Copy, Clone)]
struct HeldSymbol {
    symbol: ConstantSymbol,
    declaration: Sym,
}

impl<'p, 's> Checker<'p, 's> {
    fn names_module_graph(&self) -> bool {
        let program = self.p;
        *program.aot.symbols.names_module_graph.get_or_init(|| {
            let Some(name) = self.atoms().lookup(b"ModuleGraph") else { return false };
            let is_imported = |file: FileId| self.hir(file).kind != FileKind::Declaration && self.hir(file).import_specs.iter().any(|spec| spec.imported == name);
            self.occurs_in_code(name) || (0..program.files.modules.len() as u32).map(FileId).any(is_imported)
        })
    }

    fn is_module_evaluated_once(&self, file: FileId) -> bool {
        let module = self.files().module(file);
        module.builtin.is_some() || !module.is_commonjs() && !self.preserves_source_paths() && !self.names_module_graph()
    }

    fn symbol_initializing_constant(&self, file: FileId, e: ExprId) -> Option<HeldSymbol> {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let ExprKind::Call(call) = hir[e].kind else { return None };
        let Parent::VarInit(declaration) = bound.expr_parent[e.idx()] else { return None };
        let declared = &hir[declaration];
        if declared.kind != VarKind::Const || declared.flags.contains(Flags::AMBIENT) || !matches!(hir[declared.pat].kind, PatKind::Ident(_)) {
            return None;
        }
        let is_registered = matches!(hir[hir[call].callee].kind, ExprKind::Dot { .. });
        let mut arguments = hir.ids(hir[call].args);
        let text = match (arguments.next(), arguments.next()) {
            (None, _) => None,
            (Some(only), None) => match hir[only].kind {
                ExprKind::String(text) => Some(text),
                _ => return None,
            },
            _ => return None,
        };
        if !self.is_symbol_or_symbol_for_call(file, e) || !self.is_compiled(file) {
            return None;
        }
        let declaration = self.files().sym(file, bound.pat_symbol[declared.pat.idx()]);
        let symbol = match text {
            Some(key) if is_registered => ConstantSymbol::Registered(key),
            None if is_registered => return None,
            description if self.is_module_evaluated_once(file) && self.is_evaluated_once(file, Parent::Expr(e)) => ConstantSymbol::Created { declaration, description },
            _ => return None,
        };
        Some(HeldSymbol { symbol, declaration })
    }

    pub fn constant_symbol_created_by(&self, file: FileId, e: ExprId) -> Option<ConstantSymbol> {
        self.symbol_initializing_constant(file, e).map(|held| held.symbol)
    }

    pub fn declaration_of_constant_symbol(&self, sym: Sym) -> Option<Sym> {
        self.constant_symbol_held_by(sym, 0).map(|held| held.declaration)
    }

    fn constant_symbol_held_by(&self, sym: Sym, reexports: u8) -> Option<HeldSymbol> {
        let (file, Decl::Var(pat)) = self.variable_declaration(sym)? else { return None };
        match self.bound(file).pat_parent[pat.idx()] {
            PatParent::Var(declaration) => {
                let created_by = self.hir(file)[declaration].init.some()?;
                self.symbol_initializing_constant(file, created_by).filter(|held| held.declaration == sym)
            }
            PatParent::Prop(pattern, element) if reexports < MAX_REEXPORTS => self.constant_symbol_required_by(file, pattern, element, reexports + 1),
            _ => None,
        }
    }

    fn constant_symbol_required_by(&self, file: FileId, pattern: PatId, element: PatPropId, reexports: u8) -> Option<HeldSymbol> {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let PatParent::Var(declaration) = bound.pat_parent[pattern.idx()] else { return None };
        let (declared, element) = (&hir[declaration], &hir[element]);
        if declared.kind != VarKind::Const || declared.init.is_none() || element.is_rest || element.default.is_some() {
            return None;
        }
        let name = match (element.key, hir[element.value].kind) {
            (PropKey::Name(name), PatKind::Ident(_)) | (PropKey::None, PatKind::Ident(name)) => name,
            _ => return None,
        };
        let module = self.required_builtin_module(file, skip_assertions(hir, declared.init))?;
        if !self.files().module(module).file_name().starts_with(INTERNAL_MODULES) || self.escaped_builtin_exports()?.contains(&module) {
            return None;
        }
        let files = self.files();
        if files.module_export(files.file_symbol(module), known::default).is_none() {
            let exported = files.module_export(files.file_symbol(module), name)?;
            let exported = if files.flags(exported).contains(SymFlags::ALIAS) { files.resolve_alias(exported)? } else { exported };
            return self.constant_symbol_held_by(exported, reexports);
        }
        let hir = self.hir(module);
        let exported = hir.ids(hir.body).find_map(|stmt| match hir[stmt].kind {
            StmtKind::ExportDefault(exported) => Some(exported),
            _ => None,
        })?;
        let ExprKind::Object(props) = hir[skip_assertions(hir, exported)].kind else { return None };
        if !props.iter().all(|p| matches!(hir[p].kind, PropKind::Init | PropKind::Shorthand | PropKind::Method) && matches!(hir[p].key, PropKey::Name(_))) {
            return None;
        }
        let mut named = props.iter().filter(|&p| hir[p].key == PropKey::Name(name));
        let (Some(only), None) = (named.next(), named.next()) else { return None };
        self.constant_symbol_named_at(module, hir[only].value, reexports)
    }

    fn escaped_builtin_exports(&self) -> Option<&'p FxHashSet<FileId>> {
        let program = self.p;
        self.has_builtin_requires().then(|| {
            program.aot.symbols.escaped_builtin_exports.get_or_init(|| {
                let mut escaped = FxHashSet::default();
                for file in (0..program.files.modules.len() as u32).map(FileId).filter(|&file| program.files.module(file).builtin.is_some()) {
                    let (hir, bound) = (self.hir(file), self.bound(file));
                    for &call in self.file_exprs_by_kind(file).of(ExprTag::Call) {
                        let Some(module) = self.required_builtin_module(file, call) else { continue };
                        let mut exports = call;
                        while let Parent::Expr(around) = bound.expr_parent[exports.idx()]
                            && around.is_some()
                            && skip_assertions(hir, around) != around
                        {
                            exports = around;
                        }
                        let is_only_read = match bound.expr_parent[exports.idx()] {
                            Parent::VarInit(declaration) => matches!(hir[hir[declaration].pat].kind, PatKind::Object(elements) if elements.iter().all(|element| !hir[element].is_rest && !matches!(hir[element].key, PropKey::Computed(_)))),
                            Parent::Expr(read) if read.is_some() => {
                                let is_called_or_deleted = matches!(bound.expr_parent[read.idx()], Parent::Expr(user) if user.is_some() && match hir[user].kind {
                                    ExprKind::Call(c) | ExprKind::TaggedTemplate(c) => hir[c].callee == read,
                                    ExprKind::Unary { op: UnOp::Delete, .. } => true,
                                    _ => false,
                                });
                                matches!(hir[read].kind, ExprKind::Dot { obj, .. } if obj == exports) && bound.access_kind(hir, read) == AccessKind::Read && !is_called_or_deleted
                            }
                            _ => false,
                        };
                        if !is_only_read {
                            escaped.insert(module);
                        }
                    }
                }
                escaped
            })
        })
    }

    pub fn constant_symbol_named_by(&self, file: FileId, e: ExprId) -> Option<ConstantSymbol> {
        match self.well_known_symbol_kind_for_expr(file, e) {
            Some(symbol) => Some(ConstantSymbol::WellKnown(symbol)),
            None => self.constant_symbol_named_at(file, e, 0).map(|held| held.symbol),
        }
    }

    fn well_known_symbol_kind_for_expr(&self, file: FileId, e: ExprId) -> Option<WellKnownSymbol> {
        let hir = self.hir(file);
        let ExprKind::Dot { obj, name, chain: Chain::No, .. } = hir[e].kind else { return None };
        let symbol = WellKnownSymbol::named(self.atoms().bytes(name)).filter(|_| matches!(hir[obj].kind, ExprKind::Ident(known::Symbol)))?;
        let global = self.files().global(known::Symbol, SymFlags::VALUE)?;
        (self.resolve_identifier(file, obj, known::Symbol, true) == Ok(Some(global))).then_some(symbol)
    }

    fn constant_symbol_named_at(&self, file: FileId, e: ExprId, reexports: u8) -> Option<HeldSymbol> {
        let ExprKind::Ident(name) = self.hir(file)[e].kind else { return None };
        let named = self.resolve_identifier(file, e, name, true).ok().flatten()?;
        let named = if self.files().flags(named).contains(SymFlags::ALIAS) { self.files().resolve_alias(named)? } else { named };
        self.constant_symbol_held_by(named, reexports)
    }

    pub fn constant_symbol_of_property(&self, name: Atom) -> Option<ConstantSymbol> {
        if name.is_none() {
            return None;
        }
        let text = self.atoms().bytes(name).strip_prefix(SYMBOL_NAME_PREFIX)?;
        if let Some(symbol) = WellKnownSymbol::named(text) {
            return Some(ConstantSymbol::WellKnown(symbol));
        }
        let declaration = text.rsplit(|&byte| byte == b'@').next()?;
        let mut numbers = bun_core::strings::split(declaration, b".").map(|number| std::str::from_utf8(number).ok()?.parse::<u32>().ok());
        let (Some(Some(file)), Some(Some(id)), None) = (numbers.next(), numbers.next(), numbers.next()) else { return None };
        let held = self.constant_symbol_held_by(Sym { file: FileId(file), id: SymbolId(id) }, 0)?;
        (self.property_keyed_by_constant(held.declaration) == name).then_some(held.symbol)
    }

    fn property_keyed_by_constant(&self, declaration: Sym) -> Atom {
        let mut text = self.atoms().bytes(self.files().symbol(declaration).name).to_vec();
        text.extend_from_slice(format!("@{}.{}", declaration.file.0, declaration.id.0).as_bytes());
        self.atoms().symbol_name(&text)
    }

    pub fn property_named_by_constant_symbol(&self, file: FileId, e: ExprId) -> Option<Atom> {
        match self.well_known_symbol_kind_for_expr(file, e) {
            Some(symbol) => Some(self.atoms().symbol_name(symbol.name())),
            None => self.constant_symbol_named_at(file, e, 0).map(|held| self.property_keyed_by_constant(held.declaration)),
        }
    }

    pub fn constant_symbol_text(&self, symbol: ConstantSymbol) -> Vec<u8> {
        match symbol {
            ConstantSymbol::Created { declaration, description } => {
                let path = crate::util::spread_hash(self.files().module(declaration.file).file_name());
                let head = format!("v{path:x}.{}", declaration.id.0);
                match description {
                    Some(description) => [&[0xFC], head.as_bytes(), b":", self.atoms().bytes(description)].concat(),
                    None => [&[0xFC], head.as_bytes(), b";"].concat(),
                }
            }
            ConstantSymbol::Registered(key) => [&[0xFC], &b"r:"[..], self.atoms().bytes(key)].concat(),
            ConstantSymbol::WellKnown(symbol) => [&[0xFC], &b"w:"[..], symbol.name()].concat(),
        }
    }

    pub fn constant_symbol_description(&self, symbol: ConstantSymbol) -> Option<Vec<u8>> {
        match symbol {
            ConstantSymbol::Created { description, .. } => description.map(|description| self.atoms().bytes(description).to_vec()),
            ConstantSymbol::Registered(key) => Some(self.atoms().bytes(key).to_vec()),
            ConstantSymbol::WellKnown(symbol) => Some([b"Symbol.", symbol.name()].concat()),
        }
    }

    pub(super) fn field_key(&self, file: FileId, key: PropKey) -> Option<FieldKey> {
        match key {
            PropKey::Name(name) => Some(FieldKey::Name(name)),
            PropKey::Computed(e) => self.constant_symbol_named_by(file, e).map(FieldKey::Symbol),
            PropKey::Private(_) | PropKey::None => None,
        }
    }

    pub(super) fn field_key_of_property(&self, name: Atom) -> FieldKey {
        match self.constant_symbol_of_property(name) {
            Some(symbol) => FieldKey::Symbol(symbol),
            None => FieldKey::Name(name),
        }
    }

    pub fn known_member_name(&self, file: FileId, key: PropKey) -> Option<Atom> {
        match key {
            PropKey::Name(name) | PropKey::Private(name) => Some(name),
            PropKey::Computed(e) => self.property_named_by_constant_symbol(file, e),
            PropKey::None => None,
        }
    }
}
