//! What stands in the way of a declaration file: `Program.GetDeclarationDiagnostics`.
//!
//! tsgo runs the declaration transformer (`transformers/declarations`) over a file and keeps what it reports. The transformer goes
//! through what the file exports. A type that is written is gone through for the names in it, a type that is not is made into
//! syntax by the node builder (`checker/nodebuilderimpl.go`, `nodecopy.go`), which tells the transformer's `SymbolTracker` of each
//! symbol it names and of what it cannot write. Nothing is written here: the same way is gone, and the same is asked
//! (`checker/symbolaccessibility.go`, `checker/emitresolver.go`).

use super::enclosing_declaration::Enclosing;
use super::errors::Diagnostic;
use super::errors_isolated_declarations::Node as SyntaxNode;
use super::explain::Related;
use super::print::{
    DECLARATION_EMIT_NODE_BUILDER_FLAGS, Report, SymbolTracker,
    WRITE_CLASS_EXPRESSION_AS_TYPE_LITERAL,
};
use super::*;
use crate::bind::{
    ClassOwner, Decl, FnOwner, MemberOwner, Parent, PatParent, ScopeId, ScopeKind, SymbolId,
};
use crate::json::Json;
use crate::resolve::{
    JsxEmit, is_declaration_file_name, is_relative, join, known_extension, node_module_path_parts,
    parent_dir,
};
use crate::util::FxHashSet;
use std::rc::Rc;

/// Set in the id of the alias an `import * as ns` declares: the symbol `cloneTypeAsModuleType` makes for that import, which no file
/// declares either.
const MODULE_CLONE: u32 = 1 << 31;

/// What `resolveESModuleSymbol` gives for `originating_import`, the alias of an `import * as ns` that is not the module as it stands.
pub(super) fn module_clone(originating_import: Sym) -> Sym {
    Sym {
        file: originating_import.file,
        id: SymbolId(originating_import.id.0 | MODULE_CLONE),
    }
}

/// What a name is wanted as.
#[derive(Copy, Clone, PartialEq, Eq, Hash)]
pub(super) enum Meaning {
    /// `SymbolFlagsNone`
    None,
    Value,
    /// `SymbolFlagsValue | SymbolFlagsExportValue`, which `getQualifiedLeftMeaning` does not take for `SymbolFlagsValue`.
    ValueOfName,
    Type,
    Namespace,
}

impl Meaning {
    /// Of `SymFlags::TYPE`, `NAMESPACE` or `VALUE`. `with_export_value`: `SymbolFlagsValue | SymbolFlagsExportValue`.
    pub(super) fn of(meaning: SymFlags, with_export_value: bool) -> Meaning {
        if meaning == SymFlags::TYPE {
            Meaning::Type
        } else if meaning == SymFlags::NAMESPACE {
            Meaning::Namespace
        } else if with_export_value {
            Meaning::ValueOfName
        } else {
            Meaning::Value
        }
    }

    fn flags(self) -> SymFlags {
        match self {
            Meaning::None => SymFlags::empty(),
            Meaning::Value | Meaning::ValueOfName => SymFlags::VALUE,
            Meaning::Type => SymFlags::TYPE,
            Meaning::Namespace => SymFlags::NAMESPACE,
        }
    }

    /// `getQualifiedLeftMeaning`
    fn left(self) -> Meaning {
        if self == Meaning::Value {
            Meaning::Value
        } else {
            Meaning::Namespace
        }
    }
}

/// `symbolTableID`
#[derive(Copy, Clone, PartialEq, Eq)]
enum Table {
    Locals(FileId, ScopeId),
    Exports(Sym),
    ResolvedExports(Sym),
    Globals,
}

/// `printer.SymbolAccessibility`
#[derive(Copy, Clone, PartialEq, Eq)]
enum Accessibility {
    Accessible,
    NotAccessible,
    CannotBeNamed,
    NotResolved,
}

/// `printer.SymbolAccessibilityResult`
pub(super) struct Access {
    accessibility: Accessibility,
    /// `AliasesToMakeVisible`
    pub(super) aliases: Vec<(FileId, StmtId)>,
    symbol_name: String,
    module_name: String,
    /// `ErrorNode`: from where to where.
    error_node: Option<(u32, u32)>,
}

impl Access {
    fn accessible(aliases: Vec<(FileId, StmtId)>) -> Access {
        Access {
            accessibility: Accessibility::Accessible,
            aliases,
            symbol_name: String::new(),
            module_name: String::new(),
            error_node: None,
        }
    }

    pub(super) fn is_accessible(&self) -> bool {
        self.accessibility == Accessibility::Accessible
    }
}

/// `getSymbolAccessibilityDiagnostic`: the node whose message says that a name cannot be used.
#[derive(Copy, Clone)]
enum Context {
    /// Nothing is said.
    None,
    /// A variable declaration or a binding element, by its name.
    Variable(PatId),
    /// A property, or the name of an accessor.
    Property(MemberId),
    /// `f.name = value`, which declares a property of a function.
    Assignment(ExprId),
    /// A parameter property of a private constructor.
    ParameterProperty(ParamId),
    Accessor(MemberId),
    /// `getMethodNameVisibilityDiagnosticMessage`
    MethodName(MemberId),
    /// What a signature returns.
    Return(FnId),
    Parameter(ParamId),
    /// With the code, which goes by what it is a type parameter of.
    TypeParameter(TypeParamId, u32),
    /// `A<B>` in a heritage clause: the code, where the name of the class or interface is (nowhere if it has none), where the node is.
    Heritage(u32, (u32, u32), (u32, u32)),
    ImportEquals(ImportEqualsId, StmtId),
    TypeAlias(AliasId),
    /// `export default e`, `export = e`: where the statement is.
    DefaultExport(u32, u32),
    /// `Object.defineProperty(exports, "name", descriptor)`
    DefinedExport(ExprId),
}

/// `errorNameNode`
#[derive(Copy, Clone)]
struct NameNode {
    start: u32,
    end: u32,
    /// `ast.IsVariableDeclaration(location.Parent)`
    of_variable: bool,
}

/// `errorFallbackNode`: where `GetErrorRangeForNode` puts it, where its name is (nowhere if it has none), and what it is called then.
#[derive(Copy, Clone)]
struct FallbackNode {
    start: u32,
    end: u32,
    name: (u32, u32),
    unnamed: &'static str,
}

/// What `ensureType` is asked for the type of.
#[derive(Copy, Clone)]
enum Typed {
    Variable(VarDeclId),
    /// A binding element, by its name.
    Element(PatId),
    Property(MemberId),
    Parameter(ParamId),
    Signature(FnId),
    Export(StmtId, ExprId),
}

/// An error.
struct Found {
    start: u32,
    end: u32,
    code: u32,
    args: Vec<String>,
    related: Vec<Related>,
}

/// Which statement of a file declares what.
struct Statements {
    interfaces: Vec<StmtId>,
    aliases: Vec<StmtId>,
    enums: Vec<StmtId>,
    modules: Vec<StmtId>,
    imports: Vec<StmtId>,
    import_equals: Vec<StmtId>,
    exports: Vec<StmtId>,
}

/// `SymbolTrackerImpl` with its `SymbolTrackerSharedState` (tracker.go), which are two there so that the transformer can point at
/// the second. It is handed the checker.
struct SymbolTrackerImpl {
    current_source_file: FileId,
    diagnostics: Vec<Found>,
    get_symbol_accessibility_diagnostic: Context,
    error_name_node: Option<NameNode>,
    fallback_stack: Vec<FallbackNode>,
    late_marked_statements: Vec<StmtId>,
}

/// `DeclarationTransformer`
struct DeclarationEmit<'c, 'p> {
    c: &'c mut Checker<'p>,
    tracker: SymbolTrackerImpl,
    enclosing: Enclosing,
    suppresses_new_contexts: bool,
    in_class_expression: bool,
    /// `lateStatementReplacementMap`: the statements something is written for.
    written: FxHashSet<StmtId>,
    interface_scopes: Vec<ScopeId>,
    module_scopes: Vec<ScopeId>,
}

impl Checker<'_> {
    /// `shouldStripInternal`, of a node of `file` that is no parameter. `pos`: `node.Pos()`.
    pub(super) fn should_strip_internal(&self, file: FileId, pos: u32) -> bool {
        if !self.files().options.strips_internal_declarations {
            return false;
        }
        // `isInternalDeclaration`, `hasInternalAnnotation`
        let text = &self.hir(file).text[..];
        super::spans::get_leading_comment_ranges(text, pos as usize)
            .into_iter()
            .any(|(start, end)| bun_core::strings::contains(&text[start..end], b"@internal"))
    }
}

impl<'p> Checker<'p> {
    /// `getDeclarationDiagnosticsForFile`
    pub(super) fn check_declaration_emit(&mut self, file: FileId, out: &mut Vec<Diagnostic>) {
        let files = self.files();
        let module = files.module(file);
        // `sourceFileMayBeEmitted`
        if !matches!(module.hir.kind, FileKind::Ts | FileKind::Tsx)
            || module.path.contains("/node_modules/") && !files.options.files.contains(&module.path)
        {
            return;
        }
        // All this is asked once everything is checked: a circle that goes through here is nobody's error.
        let saved = (
            self.uncertain,
            self.relation_gave_up,
            self.relation_too_complex,
            self.union_too_complex,
        );
        self.eager.push(self.stack.len());
        let found = {
            let mut emit = DeclarationEmit::new(self, file);
            if module.hir.is_js {
                emit.transform_javascript_file();
            } else {
                emit.transform_source_file();
            }
            emit.tracker.diagnostics
        };
        self.eager.pop();
        (
            self.uncertain,
            self.relation_gave_up,
            self.relation_too_complex,
            self.union_too_complex,
        ) = saved;
        for error in found {
            let Found {
                start,
                end,
                code,
                args,
                related,
            } = error;
            out.push(Diagnostic { start, code });
            self.explain_another(start, end, code, |_| args);
            if !related.is_empty() {
                self.relate(start, code, |_| related);
            }
        }
    }
}

impl<'c, 'p> DeclarationEmit<'c, 'p> {
    fn new(c: &'c mut Checker<'p>, file: FileId) -> DeclarationEmit<'c, 'p> {
        let (hir, bound) = (c.hir(file), c.bound(file));
        let mut interface_scopes = vec![ScopeId::NONE; hir.interfaces.len()];
        let mut module_scopes = vec![ScopeId::NONE; hir.modules.len()];
        for (i, scope) in bound.scopes.iter().enumerate() {
            match scope.kind {
                ScopeKind::Interface(interface) => {
                    interface_scopes[interface.idx()] = ScopeId(i as u32);
                }
                ScopeKind::Module(module) => module_scopes[module.idx()] = ScopeId(i as u32),
                _ => {}
            }
        }
        let top = Enclosing::at_scope(file, ScopeId(0));
        DeclarationEmit {
            c,
            tracker: SymbolTrackerImpl {
                current_source_file: file,
                diagnostics: Vec::new(),
                get_symbol_accessibility_diagnostic: Context::None,
                error_name_node: None,
                fallback_stack: Vec::new(),
                late_marked_statements: Vec::new(),
            },
            enclosing: top,
            suppresses_new_contexts: false,
            in_class_expression: false,
            written: FxHashSet::default(),
            interface_scopes,
            module_scopes,
        }
    }

    fn file(&self) -> FileId {
        self.tracker.current_source_file
    }

    /// `tx.resolver`, which is the one the node builder asks.
    fn with_resolver<T>(&mut self, ask: impl FnOnce(&mut EmitResolver<'_, 'p>) -> T) -> T {
        let file = self.file();
        self.c.with_emit_resolver(file, ask)
    }
}

/// What `isDeclarationVisible`, `getAccessibleSymbolChain`, `getAlternativeContainingModules`, `getExportsOfSymbol`,
/// `getSymbolTableAliases` and `getSpecifierForModuleSymbol` memoize.
#[derive(Default)]
pub(super) struct EmitResolverLinks {
    /// `declarationLinks.isVisible`
    visibility: FxHashMap<(FileId, Decl), bool>,
    statements: FxHashMap<FileId, Rc<Statements>>,

    // `symbolContainerLinks`, `symbolTableAliasCache`
    chains: FxHashMap<(Sym, FileId, ScopeId, Meaning), Rc<Vec<Sym>>>,
    containing_modules: FxHashMap<(Sym, FileId), Rc<Vec<Sym>>>,
    exports: FxHashMap<Sym, Rc<Vec<(Atom, Sym)>>>,
    global_aliases: Option<Rc<Vec<(Atom, Sym)>>>,
    /// `specifierCache`
    specifiers: FxHashMap<(Sym, FileId, ResolutionMode), String>,
}

impl EmitResolverLinks {
    /// `addVisibleAlias`
    pub(super) fn paint_visible(&mut self, file: FileId, decl: Decl) {
        let decl = match decl {
            Decl::Param(pat) | Decl::Require(pat) => Decl::Var(pat),
            decl => decl,
        };
        self.visibility.insert((file, decl), true);
    }
}

/// `EmitResolver`, `symbolaccessibility.go` and `modulespecifiers`: the checker, and where they memoize.
pub(super) struct EmitResolver<'a, 'p> {
    pub(super) c: &'a mut Checker<'p>,
    pub(super) links: &'a mut EmitResolverLinks,
}

/// The links of the `EmitResolver`, which the printers and the declaration transformer go by, kept while they are asked from one file.
#[derive(Default)]
pub(super) struct SymbolChainCache {
    file: Option<FileId>,
    links: EmitResolverLinks,
}

impl<'p> Checker<'p> {
    /// Asks the `EmitResolver` something for a printer whose enclosing declaration is in `file`.
    fn with_emit_resolver<T>(
        &mut self,
        file: FileId,
        ask: impl FnOnce(&mut EmitResolver<'_, 'p>) -> T,
    ) -> T {
        let mut cache = std::mem::take(&mut self.symbol_chain_cache);
        if cache.file != Some(file) {
            cache = SymbolChainCache {
                file: Some(file),
                links: EmitResolverLinks::default(),
            };
        }
        let result = ask(&mut EmitResolver {
            c: &mut *self,
            links: &mut cache.links,
        });
        self.symbol_chain_cache = cache;
        result
    }

    /// `lookupSymbolChain` of a symbol that is no type parameter: whether the chain starts with `globalThis`, and the rest of it.
    pub(super) fn lookup_symbol_chain_at(
        &mut self,
        symbol: Sym,
        is_value: bool,
        yields_module: bool,
        at: Enclosing,
    ) -> (bool, Vec<Sym>) {
        let meaning = if is_value {
            Meaning::Value
        } else {
            Meaning::Type
        };
        let mut chain = self.with_emit_resolver(at.file, |resolver| {
            resolver.symbol_chain_ex(symbol, at, meaning, yields_module, 0)
        });
        let starts_with_global_this =
            chain.len() > 1 && chain[0] == self.files().global_this_symbol;
        if starts_with_global_this {
            chain.remove(0);
        }
        (starts_with_global_this, chain)
    }

    /// `lookup_symbol_chain_at`, of the symbol `cloneTypeAsModuleType` made for `originating_import`, as a value.
    pub(super) fn lookup_symbol_chain_of_module_clone_at(
        &mut self,
        originating_import: Sym,
        yields_module: bool,
        at: Enclosing,
    ) -> (bool, Vec<Sym>) {
        let symbol = module_clone(originating_import);
        self.lookup_symbol_chain_at(symbol, true, yields_module, at)
    }

    /// `IsTypeSymbolAccessible`
    pub(super) fn is_type_symbol_accessible_at(&mut self, symbol: Sym, at: Enclosing) -> bool {
        self.with_emit_resolver(at.file, |resolver| {
            resolver
                .is_any_symbol_accessible(&[symbol], at, symbol, Meaning::Type, false, 0)
                .is_some_and(|access| access.is_accessible())
        })
    }

    /// `lookupSymbolChain` as `symbolToExpression` asks it for `symbolToStringEx(symbol, enclosingDeclaration, SymbolFlagsNone, ..)`,
    /// without `yieldModuleSymbol`: whether the chain starts with `globalThis`, and the rest of it. `is_parent`: `symbol` is the
    /// parent of a symbol that is in no table, so `endOfChain` is false and the meaning is `SymbolFlagsNamespace`. The chain is
    /// empty then if nothing is written for `symbol`.
    pub(super) fn lookup_symbol_chain_for_symbol_to_string(
        &mut self,
        symbol: Sym,
        is_parent: bool,
        at: Enclosing,
    ) -> (bool, Vec<Sym>) {
        let (meaning, depth) = if is_parent {
            (Meaning::Namespace, 1)
        } else {
            (Meaning::None, 0)
        };
        let mut chain = self.with_emit_resolver(at.file, |resolver| {
            resolver.symbol_chain_ex(symbol, at, meaning, false, depth)
        });
        let starts_with_global_this =
            chain.len() > 1 && chain[0] == self.files().global_this_symbol;
        if starts_with_global_this {
            chain.remove(0);
        }
        (starts_with_global_this, chain)
    }

    /// `getAccessibleSymbolChain` as `lookup_symbol_chain_for_symbol_to_string` asks it, of a property: the alias it is written as.
    pub(super) fn accessible_alias_of_property_at(
        &mut self,
        property: &Prop,
        file: FileId,
        scope: ScopeId,
    ) -> Option<Sym> {
        let at = Enclosing::at_scope(file, scope);
        self.with_emit_resolver(file, |resolver| {
            resolver.accessible_alias_of_property(property, at)
        })
    }

    /// `getSpecifierForModuleSymbol`
    pub(super) fn specifier_for_module_symbol_at(&mut self, module: Sym, at: Enclosing) -> String {
        self.with_emit_resolver(at.file, |resolver| {
            resolver.specifier_for_module_symbol(module, at.file, ResolutionMode::None)
        })
    }

    /// The specifier of the import type `symbolToTypeNode` writes for `module`, and its `resolution-mode` attribute.
    pub(super) fn import_type_specifier_at(
        &mut self,
        module: Sym,
        at: Enclosing,
        allows_node_modules_relative_paths: bool,
    ) -> (String, Option<&'static str>) {
        self.with_emit_resolver(at.file, |resolver| {
            resolver.import_type_specifier_and_mode(
                module,
                at.file,
                allows_node_modules_relative_paths,
            )
        })
    }
}

// ───────────────────────────── symbols ─────────────────────────────

impl<'p> Checker<'p> {
    /// `IsSymbolAccessible(symbol, enclosingDeclaration, meaning, false)`. `meaning`, `with_export_value`: see `Meaning::of`.
    pub(super) fn is_symbol_accessible_at(
        &mut self,
        symbol: Sym,
        meaning: SymFlags,
        with_export_value: bool,
        at: Enclosing,
    ) -> bool {
        let meaning = Meaning::of(meaning, with_export_value);
        self.with_emit_resolver(at.file, |resolver| {
            resolver
                .is_symbol_accessible(symbol, at, meaning, false)
                .is_accessible()
        })
    }

    /// `isTriviallySerializableComputedName`, of the computed property name `[name]` written in `file`.
    pub(super) fn is_trivially_serializable_computed_name_at(
        &mut self,
        file: FileId,
        name: ExprId,
        at: Enclosing,
    ) -> bool {
        if !is_entity_name_expression(self.hir(file), name) {
            return false;
        }
        let Some((first, _)) = self.first_identifier(file, name) else {
            return false;
        };
        self.with_emit_resolver(at.file, |resolver| {
            resolver
                .is_entity_name_visible(first, None, Meaning::ValueOfName, at, false)
                .is_accessible()
        })
    }

    /// `exportTypeLinks.Get(symbol).target` of a symbol `cloneTypeAsModuleType` made, which has the flags, the name, the declarations,
    /// the parent and the exports of that. Any other symbol is given back.
    fn target_of_module_clone(&self, symbol: Sym) -> Sym {
        if symbol.id.0 & MODULE_CLONE == 0 {
            return symbol;
        }
        let originating_import = Sym {
            file: symbol.file,
            id: SymbolId(symbol.id.0 & !MODULE_CLONE),
        };
        self.target_of_alias(originating_import)
            .unwrap_or(originating_import)
    }

    pub(super) fn flags_of(&self, symbol: Sym) -> SymFlags {
        self.files().flags(self.target_of_module_clone(symbol))
    }

    fn decls_of(&self, symbol: Sym) -> Vec<(FileId, Decl)> {
        self.files().decls(self.target_of_module_clone(symbol))
    }

    fn name_of(&self, symbol: Sym) -> Atom {
        self.files()
            .symbol(self.target_of_module_clone(symbol))
            .name
    }

    /// `symbolToString`
    fn symbol_text(&mut self, symbol: Sym) -> String {
        if symbol == self.files().global_this_symbol {
            return "globalThis".to_owned();
        }
        let symbol = self.target_of_module_clone(symbol);
        self.symbol_to_string(symbol)
    }

    /// `getParentOfSymbol`
    fn parent_of_symbol(&self, symbol: Sym) -> Option<Sym> {
        self.files()
            .parent_of_symbol(self.target_of_module_clone(symbol))
    }

    /// `core.Some(symbol.Declarations, hasNonGlobalAugmentationExternalModuleSymbol)`
    fn is_external_module_symbol(&self, symbol: Sym) -> bool {
        self.files()
            .parts(self.target_of_module_clone(symbol))
            .iter()
            .any(|&part| self.is_external_module_part(part))
    }

    /// `is_external_module_symbol`, of the symbol one file has made.
    fn is_external_module_part(&self, part: Sym) -> bool {
        let files = self.files();
        files.symbol(part).decls.iter().any(|&decl| match decl {
            Decl::File => files.module(part.file).is_module(),
            Decl::Module(m) => matches!(self.hir(part.file)[m].name, ModuleName::String(_)),
            _ => false,
        })
    }

    /// `getMergedSymbol`
    fn merged_symbol(&self, symbol: Sym) -> Sym {
        if symbol.id.0 & MODULE_CLONE != 0 {
            return symbol;
        }
        self.files().canonical(symbol)
    }

    /// `getMergedSymbol(symbol.ExportSymbol)`
    fn export_symbol_of(&self, symbol: Sym) -> Option<Sym> {
        if symbol.id.0 & MODULE_CLONE != 0 {
            return None;
        }
        let id = self.files().symbol(symbol).export_symbol;
        id.is_some().then(|| self.files().sym(symbol.file, id))
    }

    /// `GetSourceFileOfModule`
    fn source_file_of_module(&self, symbol: Sym) -> Option<FileId> {
        if symbol == self.files().global_this_symbol {
            return None;
        }
        let files = self.files();
        let parts = files.parts(self.target_of_module_clone(symbol));
        let declares = |meaning: SymFlags| {
            parts
                .iter()
                .find(|&&part| files.symbol(part).flags.intersects(meaning))
        };
        // `SetValueDeclaration`: other kinds of value declarations take precedence over modules.
        declares(SymFlags::VALUE.difference(SymFlags::VALUE_MODULE))
            .or_else(|| declares(SymFlags::VALUE_MODULE))
            // `GetNonAugmentationDeclaration`
            .or_else(|| {
                parts
                    .iter()
                    .find(|&&part| !self.is_external_module_part(part))
            })
            .map(|part| part.file)
    }

    /// `core.FirstNonNil(symbol.Declarations, c.getExternalModuleContainer)`
    fn external_module_container_of_symbol(&self, symbol: Sym) -> Option<Sym> {
        if symbol == self.files().global_this_symbol {
            return None;
        }
        let files = self.files();
        for part in files.parts(self.target_of_module_clone(symbol)) {
            let (hir, bound) = (self.hir(part.file), self.bound(part.file));
            let mut at = part.id;
            loop {
                let declared = &bound.symbols[at.idx()];
                // `hasExternalModuleSymbol`
                let is_module = declared.decls.iter().any(|&decl| match decl {
                    Decl::File => files.module(part.file).is_module(),
                    Decl::Module(m) => !matches!(hir[m].name, ModuleName::Ident(_)),
                    _ => false,
                });
                if is_module {
                    return Some(files.sym(part.file, at));
                }
                if declared.parent.is_none() {
                    break;
                }
                at = declared.parent;
            }
            if files.module(part.file).is_module() {
                return Some(files.file_symbol(part.file));
            }
        }
        None
    }

    /// `c.getExternalModuleContainer(enclosingDeclaration)`
    fn external_module_container_of_scope(&self, at: Enclosing) -> Option<Sym> {
        let files = self.files();
        let (hir, bound) = (self.hir(at.file), self.bound(at.file));
        let mut scope = at.scope;
        while scope.is_some() {
            let s = &bound.scopes[scope.idx()];
            if let ScopeKind::Module(m) = s.kind
                && !matches!(hir[m].name, ModuleName::Ident(_))
                && s.symbol.is_some()
            {
                return Some(files.sym(at.file, s.symbol));
            }
            scope = s.parent;
        }
        files
            .module(at.file)
            .is_module()
            .then(|| files.file_symbol(at.file))
    }

    /// `resolveSymbol`
    fn resolve_symbol(&mut self, symbol: Sym) -> Sym {
        if symbol.id.0 & MODULE_CLONE != 0 {
            return symbol;
        }
        let files = self.files();
        let flags = files.flags(symbol);
        // `IsNonLocalAlias`
        if flags.contains(SymFlags::ALIAS)
            && !flags.intersects(SymFlags::VALUE | SymFlags::TYPE | SymFlags::NAMESPACE)
        {
            return match self.originating_import_of_alias(symbol) {
                Some(originating_import) => module_clone(originating_import),
                None => files.resolve_alias(symbol).unwrap_or(symbol),
            };
        }
        symbol
    }

    /// `getSymbolIfSameReference(a, b) != nil`
    fn is_same_reference(&mut self, a: Sym, b: Sym) -> bool {
        self.resolve_symbol(a) == self.resolve_symbol(b)
    }

    /// `compareSymbols`: by where they are first declared.
    fn compare_symbols_of_chain(&self, a: Sym, b: Sym) -> std::cmp::Ordering {
        let place = |symbol: Sym| match self.decls_of(symbol).first() {
            Some(&(file, decl)) => {
                let start = self.declaration_name_start(file, decl).unwrap_or(0);
                (0, self.place_in_program_order(file, start))
            }
            None => (1, (false, 0, 0)),
        };
        place(a).cmp(&place(b)).then(a.cmp(&b))
    }

    fn compare_symbol_chains(&self, a: &[Sym], b: &[Sym]) -> std::cmp::Ordering {
        let mut order = a.len().cmp(&b.len());
        for (&x, &y) in a.iter().zip(b) {
            order = order.then_with(|| self.compare_symbols_of_chain(x, y));
        }
        order
    }

    /// `resolve_alias`, with its target in place of a symbol `cloneTypeAsModuleType` made.
    fn target_of_alias(&self, alias: Sym) -> Option<Sym> {
        let files = self.files();
        let target = files.canonical(files.alias_target(alias)?);
        files.resolve_alias_as(
            target,
            SymFlags::VALUE | SymFlags::TYPE | SymFlags::NAMESPACE,
        )
    }

    /// `GetFirstIdentifier`: the name, and where it is written.
    fn first_identifier(&self, file: FileId, e: ExprId) -> Option<(Atom, u32)> {
        let hir = self.hir(file);
        let first = &hir[first_identifier(hir, e)];
        match first.kind {
            ExprKind::Ident(name) => Some((name, first.pos)),
            _ => None,
        }
    }
}

// ───────────────────────────── what is visible ─────────────────────────────

impl<'p> EmitResolver<'_, 'p> {
    fn statements_of(&mut self, file: FileId) -> Rc<Statements> {
        if let Some(known) = self.links.statements.get(&file) {
            return Rc::clone(known);
        }
        let hir = self.c.hir(file);
        let mut statements = Statements {
            interfaces: vec![StmtId::NONE; hir.interfaces.len()],
            aliases: vec![StmtId::NONE; hir.aliases.len()],
            enums: vec![StmtId::NONE; hir.enums.len()],
            modules: vec![StmtId::NONE; hir.modules.len()],
            imports: vec![StmtId::NONE; hir.imports.len()],
            import_equals: vec![StmtId::NONE; hir.import_equals.len()],
            exports: vec![StmtId::NONE; hir.exports.len()],
        };
        for (i, statement) in hir.stmts.iter().enumerate() {
            let s = StmtId(i as u32);
            match statement.kind {
                StmtKind::Interface(id) => statements.interfaces[id.idx()] = s,
                StmtKind::TypeAlias(id) => statements.aliases[id.idx()] = s,
                StmtKind::Enum(id) => statements.enums[id.idx()] = s,
                StmtKind::Module(id) => statements.modules[id.idx()] = s,
                StmtKind::Import(id) => statements.imports[id.idx()] = s,
                StmtKind::ImportEquals(id) => statements.import_equals[id.idx()] = s,
                StmtKind::ExportNamed(id) => statements.exports[id.idx()] = s,
                _ => {}
            }
        }
        let statements = Rc::new(statements);
        self.links.statements.insert(file, Rc::clone(&statements));
        statements
    }

    /// The statement that is the declaration `decl`, or that an import or an export specifier is written in.
    fn statement_of(&mut self, file: FileId, decl: Decl) -> Option<StmtId> {
        let (hir, bound) = (self.c.hir(file), self.c.bound(file));
        let statement = match decl {
            Decl::Fn(f) => match bound.fns[f.idx()].owner {
                FnOwner::Stmt(s) => s,
                _ => return None,
            },
            Decl::Class(c) => match bound.class_owner[c.idx()] {
                ClassOwner::Stmt(s) => s,
                ClassOwner::Expr(_) => return None,
            },
            Decl::Interface(i) => self.statements_of(file).interfaces[i.idx()],
            Decl::Alias(a) => self.statements_of(file).aliases[a.idx()],
            Decl::Enum(e) => self.statements_of(file).enums[e.idx()],
            Decl::Module(m) => self.statements_of(file).modules[m.idx()],
            Decl::ImportEquals(i) => self.statements_of(file).import_equals[i.idx()],
            Decl::ImportDefault(i) | Decl::ImportNamespace(i) => {
                self.statements_of(file).imports[i.idx()]
            }
            Decl::ImportSpec(s) => self.statements_of(file).imports[hir[s].import.idx()],
            Decl::ExportSpec(s) => self.statements_of(file).exports[hir[s].export.idx()],
            _ => return None,
        };
        statement.is_some().then_some(statement)
    }

    /// `isDeclarationVisible`, of what statements are written in: a file, the block of a namespace, or anything else.
    fn is_container_visible(&mut self, file: FileId, container: Parent) -> bool {
        match container {
            Parent::File => true,
            Parent::Module(m) => self.is_declaration_visible(file, Decl::Module(m)),
            _ => false,
        }
    }

    /// `isDeclarationVisible`
    pub(super) fn is_declaration_visible(&mut self, file: FileId, decl: Decl) -> bool {
        // A name is bound by one node, whatever it is bound as.
        let decl = match decl {
            Decl::Param(pat) | Decl::Require(pat) => Decl::Var(pat),
            decl => decl,
        };
        if let Some(&known) = self.links.visibility.get(&(file, decl)) {
            return known;
        }
        let is_visible = self.determine_if_declaration_is_visible(file, decl);
        self.links.visibility.insert((file, decl), is_visible);
        is_visible
    }

    /// `determineIfDeclarationIsVisible`
    fn determine_if_declaration_is_visible(&mut self, file: FileId, decl: Decl) -> bool {
        let (hir, bound) = (self.c.hir(file), self.c.bound(file));
        let (flags, container) = match decl {
            Decl::File | Decl::UmdGlobal(_) | Decl::TypeParam(_) => return true,
            Decl::Var(pat) => match bound.pat_parent[pat.idx()] {
                PatParent::Prop(outer, _) | PatParent::Elem(outer, _) => {
                    return self.is_declaration_visible(file, Decl::Var(outer));
                }
                PatParent::Param(p) => {
                    return self.is_function_visible(file, bound.param_fn[p.idx()]);
                }
                PatParent::None => return false,
                PatParent::Var(d) => {
                    let is_empty = match hir[pat].kind {
                        PatKind::Object(props) => props.is_empty(),
                        PatKind::Array(elems) => elems.is_empty(),
                        _ => false,
                    };
                    let statement = bound.var_stmt[d.idx()];
                    if is_empty || statement.is_none() {
                        return false;
                    }
                    // `GetDeclarationContainer`: the declarations in the head of a loop are in what the loop is in.
                    let container = match bound.stmt_parent[statement.idx()] {
                        Parent::Stmt(around)
                            if matches!(
                                hir[around].kind,
                                StmtKind::For { .. }
                                    | StmtKind::ForIn { .. }
                                    | StmtKind::ForOf { .. }
                            ) =>
                        {
                            bound.stmt_parent[around.idx()]
                        }
                        container => container,
                    };
                    (hir[d].flags, container)
                }
            },
            Decl::Fn(_)
            | Decl::Class(_)
            | Decl::Interface(_)
            | Decl::Alias(_)
            | Decl::Enum(_)
            | Decl::Module(_)
            | Decl::ImportEquals(_) => {
                let Some(statement) = self.statement_of(file, decl) else {
                    return false;
                };
                let flags = match decl {
                    Decl::Fn(f) => hir[f].flags,
                    Decl::Class(c) => hir[c].flags,
                    Decl::Interface(i) => hir[i].flags,
                    Decl::Alias(a) => hir[a].flags,
                    Decl::Enum(e) => hir[e].flags,
                    Decl::Module(m) => hir[m].flags,
                    Decl::ImportEquals(i) => hir[i].flags,
                    _ => Flags::empty(),
                };
                (flags, bound.stmt_parent[statement.idx()])
            }
            Decl::ExportSpec(_) => {
                let Some(statement) = self.statement_of(file, decl) else {
                    return false;
                };
                let StmtKind::ExportNamed(export) = hir[statement].kind else {
                    return false;
                };
                return hir[export].spec.is_none()
                    && self.is_container_visible(file, bound.stmt_parent[statement.idx()]);
            }
            _ => return false,
        };
        let is_module = self.c.files().module(file).is_module();
        // `IsExternalModuleAugmentation`
        if let Decl::Module(m) = decl
            && !matches!(hir[m].name, ModuleName::Ident(_))
        {
            let is_augmentation = match container {
                Parent::File => hir.has_module_syntax,
                Parent::Module(around) => {
                    !matches!(hir[around].name, ModuleName::Ident(_))
                        && !hir.has_module_syntax
                        && self
                            .statement_of(file, Decl::Module(around))
                            .is_some_and(|s| bound.stmt_parent[s.idx()] == Parent::File)
                }
                _ => false,
            };
            if is_augmentation {
                return true;
            }
        }
        let is_in_ambient_block = matches!(container, Parent::Module(around)
            if hir[around].flags.contains(Flags::AMBIENT) || hir.kind == FileKind::Declaration);
        if !flags.contains(Flags::EXPORT)
            && !(is_in_ambient_block && !matches!(decl, Decl::ImportEquals(_)))
        {
            // `IsGlobalSourceFile`
            return container == Parent::File && !is_module;
        }
        self.is_container_visible(file, container)
    }

    /// `isDeclarationVisible`, of what has parameters. A type that is written is taken to be written where it is seen.
    fn is_function_visible(&mut self, file: FileId, f: FnId) -> bool {
        let (hir, bound) = (self.c.hir(file), self.c.bound(file));
        match bound.fns[f.idx()].owner {
            FnOwner::Stmt(_) => self.is_declaration_visible(file, Decl::Fn(f)),
            FnOwner::Member(m) => {
                let is_signature = matches!(
                    hir[m].kind,
                    MemberKind::Constructor
                        | MemberKind::CallSignature
                        | MemberKind::ConstructSignature
                        | MemberKind::IndexSignature
                );
                if !is_signature && hir[m].flags.intersects(Flags::PRIVATE | Flags::PROTECTED) {
                    return false;
                }
                match bound.member_owner[m.idx()] {
                    MemberOwner::Class(c) => self.is_declaration_visible(file, Decl::Class(c)),
                    MemberOwner::Interface(i) => {
                        self.is_declaration_visible(file, Decl::Interface(i))
                    }
                    MemberOwner::TypeLiteral(_) => true,
                    MemberOwner::None => false,
                }
            }
            FnOwner::Type(_) => true,
            FnOwner::Expr(_) | FnOwner::None => false,
        }
    }

    /// `hasVisibleDeclarations`: `None` if some declaration of `symbol` is not and cannot be made visible, or else the statements that
    /// have to be written for it to be. `paints`: `shouldComputeAliasToMakeVisible`.
    pub(super) fn has_visible_declarations(
        &mut self,
        symbol: Sym,
        paints: bool,
    ) -> Option<Vec<(FileId, StmtId)>> {
        let mut aliases: Vec<(FileId, StmtId)> = Vec::new();
        let flags = self.c.flags_of(symbol);
        for (file, decl) in self.c.decls_of(symbol) {
            if self.is_declaration_visible(file, decl) {
                continue;
            }
            let (hir, bound) = (self.c.hir(file), self.c.bound(file));
            let statement = match decl {
                // `getAnyImportSyntax`, `IsLateVisibilityPaintedStatement`
                Decl::ImportDefault(_)
                | Decl::ImportNamespace(_)
                | Decl::ImportSpec(_)
                | Decl::ImportEquals(_)
                | Decl::Fn(_)
                | Decl::Class(_)
                | Decl::Interface(_)
                | Decl::Alias(_)
                | Decl::Enum(_)
                | Decl::Module(_) => {
                    let is_exported = match decl {
                        Decl::ImportEquals(i) => hir[i].flags,
                        Decl::Fn(f) => hir[f].flags,
                        Decl::Class(c) => hir[c].flags,
                        Decl::Interface(i) => hir[i].flags,
                        Decl::Alias(a) => hir[a].flags,
                        Decl::Enum(e) => hir[e].flags,
                        Decl::Module(m) => hir[m].flags,
                        _ => Flags::empty(),
                    }
                    .contains(Flags::EXPORT);
                    if is_exported {
                        return None;
                    }
                    self.statement_of(file, decl)?
                }
                Decl::Var(pat) | Decl::Require(pat) => {
                    // `WalkUpBindingElementsAndPatterns`
                    let mut root = pat;
                    while let PatParent::Prop(outer, _) | PatParent::Elem(outer, _) =
                        bound.pat_parent[root.idx()]
                    {
                        root = outer;
                    }
                    let PatParent::Var(d) = bound.pat_parent[root.idx()] else {
                        return None;
                    };
                    let is_element = root != pat;
                    if is_element && !flags.contains(SymFlags::BLOCK_SCOPED_VARIABLE) {
                        return None;
                    }
                    let statement = bound.var_stmt[d.idx()];
                    // `ast.IsVariableStatement`: not the head of a loop, and not what is caught.
                    if statement.is_none()
                        || !matches!(hir[statement].kind, StmtKind::Var(_))
                        || matches!(bound.stmt_parent[statement.idx()], Parent::Stmt(around)
                        if matches!(
                            hir[around].kind,
                            StmtKind::For { .. } | StmtKind::ForIn { .. } | StmtKind::ForOf { .. }
                        ))
                    {
                        return None;
                    }
                    if hir[d].flags.contains(Flags::EXPORT) {
                        if is_element {
                            continue;
                        }
                        return None;
                    }
                    statement
                }
                _ => return None,
            };
            if !self.is_container_visible(file, bound.stmt_parent[statement.idx()]) {
                return None;
            }
            if paints {
                self.links.paint_visible(file, decl);
                if !aliases.contains(&(file, statement)) {
                    aliases.push((file, statement));
                }
            }
        }
        Some(aliases)
    }

    /// `isEntityNameVisible`, of a name that starts with the identifier `first`. `start`: where that is written in the file of `at`,
    /// for `ErrorNode`.
    pub(super) fn is_entity_name_visible(
        &mut self,
        first: Atom,
        start: Option<u32>,
        meaning: Meaning,
        at: Enclosing,
        should_compute_alias_to_make_visible: bool,
    ) -> Access {
        let found = self
            .c
            .files()
            .resolve_name(at.file, at.scope, first, meaning.flags());
        let mut result = Access {
            accessibility: Accessibility::NotResolved,
            aliases: Vec::new(),
            symbol_name: self.c.atom_text(first),
            module_name: String::new(),
            error_node: start.map(|start| (start, self.c.end_of_name_at(at.file, start))),
        };
        let Some(symbol) = found else {
            return result;
        };
        if meaning == Meaning::Type && self.c.flags_of(symbol).contains(SymFlags::TYPE_PARAMETER) {
            return Access::accessible(Vec::new());
        }
        match self.has_visible_declarations(symbol, should_compute_alias_to_make_visible) {
            Some(aliases) => Access::accessible(aliases),
            None => {
                result.accessibility = Accessibility::NotAccessible;
                result
            }
        }
    }
}

// ───────────────────────────── what can be named ─────────────────────────────

impl<'p> EmitResolver<'_, 'p> {
    /// `getExportsOfSymbol`
    fn exports_of_symbol(&mut self, symbol: Sym) -> Rc<Vec<(Atom, Sym)>> {
        let symbol = self.c.target_of_module_clone(symbol);
        if let Some(known) = self.links.exports.get(&symbol) {
            return Rc::clone(known);
        }
        let files = self.c.files();
        let exports = if symbol == files.global_this_symbol {
            Vec::new()
        } else if files.flags(symbol).intersects(SymFlags::MODULE) {
            // `getExportsOfModuleWorker`
            files.exports_of_module(symbol).to_vec()
        } else {
            files.exports(symbol)
        };
        let exports = Rc::new(exports);
        self.links.exports.insert(symbol, Rc::clone(&exports));
        exports
    }

    /// `someSymbolTableInScope`: the tables, innermost first.
    fn tables_in_scope(&self, at: Enclosing) -> Vec<Table> {
        let files = self.c.files();
        let bound = self.c.bound(at.file);
        let mut tables = Vec::new();
        let mut scope = at.scope;
        while scope.is_some() {
            let s = &bound.scopes[scope.idx()];
            match s.kind {
                // `IsGlobalSourceFile`: what a script declares is global.
                ScopeKind::File if s.symbol.is_none() => {}
                ScopeKind::File | ScopeKind::Module(_) => {
                    tables.push(Table::Locals(at.file, scope));
                    if s.symbol.is_some() {
                        tables.push(Table::Exports(files.sym(at.file, s.symbol)));
                    }
                }
                ScopeKind::Enum(_) => {}
                _ => tables.push(Table::Locals(at.file, scope)),
            }
            scope = s.parent;
        }
        tables.push(Table::Globals);
        tables
    }

    /// `symbols[name]`, as the table has it: `mergeSymbol` merges into a clone, and a table that is not merged keeps the original.
    fn lookup(&mut self, table: Table, name: Atom) -> Option<Sym> {
        if name.is_none() {
            return None;
        }
        let files = self.c.files();
        match table {
            Table::Locals(file, scope) => {
                let bound = self.c.bound(file);
                bound
                    .lookup(bound.scopes[scope.idx()].locals, name)
                    .map(|id| Sym { file, id })
            }
            Table::Exports(symbol) => files.export_in_table(symbol, name),
            Table::ResolvedExports(symbol) if symbol != files.global_this_symbol => self
                .exports_of_symbol(symbol)
                .iter()
                .find(|export| export.0 == name)
                .map(|export| export.1),
            Table::ResolvedExports(_) | Table::Globals => files.globals.get(&name).copied(),
        }
    }

    /// `symbols[symbol.Name]`
    fn lookup_symbol(&mut self, table: Table, symbol: Sym) -> Option<Sym> {
        self.lookup(table, self.c.name_of(symbol))
    }

    /// `getSymbolTableAliases`, each with the name it is in the table under.
    fn aliases_in_table(&mut self, table: Table) -> Rc<Vec<(Atom, Sym)>> {
        let files = self.c.files();
        let is_alias = |entry: &(Atom, Sym)| files.flags(entry.1).contains(SymFlags::ALIAS);
        let aliases: Vec<(Atom, Sym)> = match table {
            Table::Locals(file, scope) => {
                let bound = self.c.bound(file);
                bound
                    .table(bound.scopes[scope.idx()].locals)
                    .iter()
                    .map(|&(name, id)| (name, files.sym(file, id)))
                    .filter(is_alias)
                    .collect()
            }
            Table::Exports(symbol) => files.each_export(symbol).filter(is_alias).collect(),
            Table::ResolvedExports(symbol) if symbol != files.global_this_symbol => self
                .exports_of_symbol(symbol)
                .iter()
                .copied()
                .filter(is_alias)
                .collect(),
            Table::ResolvedExports(_) | Table::Globals => {
                if let Some(known) = &self.links.global_aliases {
                    return Rc::clone(known);
                }
                let mut aliases: Vec<(Atom, Sym)> = files
                    .globals
                    .iter()
                    .map(|(&name, &symbol)| (name, symbol))
                    .filter(is_alias)
                    .collect();
                aliases.sort_unstable();
                let aliases = Rc::new(aliases);
                self.links.global_aliases = Some(Rc::clone(&aliases));
                return aliases;
            }
        };
        Rc::new(aliases)
    }

    /// `getAccessibleSymbolChain`. Empty: there is none.
    fn accessible_symbol_chain(
        &mut self,
        symbol: Sym,
        at: Enclosing,
        meaning: Meaning,
    ) -> Rc<Vec<Sym>> {
        let mut visited = Vec::new();
        self.accessible_symbol_chain_ex(symbol, at, meaning, &mut visited)
    }

    /// `getAccessibleSymbolChainEx`. `visited`: `visitedSymbolTablesMap`.
    fn accessible_symbol_chain_ex(
        &mut self,
        symbol: Sym,
        at: Enclosing,
        meaning: Meaning,
        visited: &mut Vec<(Sym, Table)>,
    ) -> Rc<Vec<Sym>> {
        let key = (symbol, at.file, at.scope, meaning);
        if let Some(known) = self.links.chains.get(&key) {
            return Rc::clone(known);
        }
        let mut result = Vec::new();
        for table in self.tables_in_scope(at) {
            result = self.chain_from_table(symbol, at, meaning, table, false, true, visited);
            if !result.is_empty() {
                break;
            }
        }
        let result = Rc::new(result);
        self.links.chains.insert(key, Rc::clone(&result));
        result
    }

    /// `getAccessibleSymbolChainFromSymbolTable`
    #[allow(clippy::too_many_arguments)]
    fn chain_from_table(
        &mut self,
        symbol: Sym,
        at: Enclosing,
        meaning: Meaning,
        table: Table,
        ignores_qualification: bool,
        is_local_name_lookup: bool,
        visited: &mut Vec<(Sym, Table)>,
    ) -> Vec<Sym> {
        if visited.contains(&(symbol, table)) {
            return Vec::new();
        }
        visited.push((symbol, table));
        let result = self.try_symbol_table(
            symbol,
            at,
            meaning,
            table,
            ignores_qualification,
            is_local_name_lookup,
            visited,
        );
        visited.retain(|&entry| entry != (symbol, table));
        result
    }

    /// `trySymbolTable`
    #[allow(clippy::too_many_arguments)]
    fn try_symbol_table(
        &mut self,
        symbol: Sym,
        at: Enclosing,
        meaning: Meaning,
        table: Table,
        ignores_qualification: bool,
        is_local_name_lookup: bool,
        visited: &mut Vec<(Sym, Table)>,
    ) -> Vec<Sym> {
        let res = self.lookup_symbol(table, symbol);
        if let Some(res) = res
            && self.is_accessible(
                symbol,
                at,
                meaning,
                res,
                None,
                ignores_qualification,
                visited,
            )
        {
            return vec![symbol];
        }
        let mut candidates: Vec<Vec<Sym>> = Vec::new();
        if let Some(export_symbol) = res.and_then(|res| self.c.export_symbol_of(res))
            && self.is_accessible(
                symbol,
                at,
                meaning,
                export_symbol,
                None,
                ignores_qualification,
                visited,
            )
        {
            candidates.push(vec![symbol]);
        }
        for alias in self.aliases_to_try(table, at, ignores_qualification, is_local_name_lookup) {
            let Some(resolved) = self.resolve_alias(alias) else {
                continue;
            };
            let candidate = self.candidate_list_for_symbol(
                symbol,
                at,
                meaning,
                alias,
                resolved,
                ignores_qualification,
                visited,
            );
            if !candidate.is_empty() {
                candidates.push(candidate);
            }
        }
        if !candidates.is_empty() {
            // The first of the shortest.
            candidates.sort_by(|a, b| self.c.compare_symbol_chains(a, b));
            return candidates.swap_remove(0);
        }
        if table == Table::Globals {
            let global_this = self.c.files().global_this_symbol;
            return self.candidate_list_for_symbol(
                symbol,
                at,
                meaning,
                global_this,
                global_this,
                ignores_qualification,
                visited,
            );
        }
        Vec::new()
    }

    /// The aliases of `table` that `trySymbolTable` asks what they resolve to.
    fn aliases_to_try(
        &mut self,
        table: Table,
        at: Enclosing,
        ignores_qualification: bool,
        is_local_name_lookup: bool,
    ) -> Vec<Sym> {
        let is_in_module = self.c.hir(at.file).has_module_syntax;
        let mut aliases = Vec::new();
        for &(name, alias) in self.aliases_in_table(table).iter() {
            if name == known::export_equals || name == known::default {
                continue;
            }
            let decls = self.c.decls_of(alias);
            // `isUMDExportSymbol`
            if is_in_module && matches!(decls.first(), Some((_, Decl::UmdGlobal(_)))) {
                continue;
            }
            // `isNamespaceReexportDeclaration`
            if is_local_name_lookup && decls.iter().any(|d| matches!(d.1, Decl::ExportStarAs(_))) {
                continue;
            }
            if !ignores_qualification && decls.iter().any(|d| matches!(d.1, Decl::ExportSpec(_))) {
                continue;
            }
            aliases.push(alias);
        }
        aliases
    }

    /// `getAccessibleSymbolChain(property, enclosingDeclaration, SymbolFlagsNone, ..)`. A property is in no table, so the chain is
    /// an alias that resolves to it.
    fn accessible_alias_of_property(&mut self, property: &Prop, at: Enclosing) -> Option<Sym> {
        // `isPropertyOrMethodDeclarationSymbol`
        let is_property_or_method_declaration = match &property.source {
            PropSource::Members(list) => list.iter().all(|&(file, member)| {
                let is_in_class = matches!(
                    self.c.bound(file).member_owner[member.idx()],
                    MemberOwner::Class(_)
                );
                match self.c.hir(file)[member].kind {
                    MemberKind::Getter | MemberKind::Setter => true,
                    MemberKind::Property | MemberKind::Method => is_in_class,
                    _ => false,
                }
            }),
            PropSource::Literal(file, written) => matches!(
                self.c.hir(*file)[*written].kind,
                PropKind::Method | PropKind::Getter | PropKind::Setter
            ),
            _ => false,
        };
        if is_property_or_method_declaration {
            return None;
        }
        for table in self.tables_in_scope(at) {
            let mut candidates = Vec::new();
            for alias in self.aliases_to_try(table, at, false, true) {
                if self.c.property_of_alias(alias) == Some(property)
                    && self.can_qualify_symbol(at, alias, Meaning::None, &mut Vec::new())
                {
                    candidates.push(alias);
                }
            }
            candidates.sort_by(|&a, &b| self.c.compare_symbols_of_chain(a, b));
            if let Some(&first) = candidates.first() {
                return Some(first);
            }
        }
        None
    }

    /// `resolveAlias`: what the alias is declared to stand for, and on from there while that is an alias and nothing else
    /// (`resolveSymbol`, `isNonLocalAlias`).
    fn resolve_alias(&mut self, alias: Sym) -> Option<Sym> {
        match self.c.originating_import_of_alias(alias) {
            Some(originating_import) => Some(module_clone(originating_import)),
            None => {
                let target = self.c.target_of_alias(alias)?;
                // `combineValueAndTypeSymbols` makes a symbol that nothing else is and that exports nothing.
                let is_combined = !self.c.flags_of(target).intersects(SymFlags::VALUE)
                    && self.c.imported_property_of_export_equals(alias).is_some();
                (!is_combined).then_some(target)
            }
        }
    }

    /// `getCandidateListForSymbol`
    #[allow(clippy::too_many_arguments)]
    fn candidate_list_for_symbol(
        &mut self,
        symbol: Sym,
        at: Enclosing,
        meaning: Meaning,
        from_table: Sym,
        resolved: Sym,
        ignores_qualification: bool,
        visited: &mut Vec<(Sym, Table)>,
    ) -> Vec<Sym> {
        if self.is_accessible(
            symbol,
            at,
            meaning,
            from_table,
            Some(resolved),
            ignores_qualification,
            visited,
        ) {
            return vec![from_table];
        }
        let from_exports = self.chain_from_table(
            symbol,
            at,
            meaning,
            Table::ResolvedExports(resolved),
            true,
            false,
            visited,
        );
        if from_exports.is_empty()
            || !self.can_qualify_symbol(at, from_table, meaning.left(), visited)
        {
            return Vec::new();
        }
        let mut chain = vec![from_table];
        chain.extend(from_exports);
        chain
    }

    /// `isAccessible`
    #[allow(clippy::too_many_arguments)]
    fn is_accessible(
        &mut self,
        symbol: Sym,
        at: Enclosing,
        meaning: Meaning,
        from_table: Sym,
        resolved: Option<Sym>,
        ignores_qualification: bool,
        visited: &mut Vec<(Sym, Table)>,
    ) -> bool {
        let merged = self.c.merged_symbol(from_table);
        if symbol != merged && Some(symbol) != resolved {
            return false;
        }
        !self.c.is_external_module_symbol(from_table)
            && (ignores_qualification || self.can_qualify_symbol(at, merged, meaning, visited))
    }

    /// `canQualifySymbol`
    fn can_qualify_symbol(
        &mut self,
        at: Enclosing,
        from_table: Sym,
        meaning: Meaning,
        visited: &mut Vec<(Sym, Table)>,
    ) -> bool {
        if !self.needs_qualification(from_table, at, meaning) {
            return true;
        }
        match self.c.parent_of_symbol(from_table) {
            Some(parent) => !self
                .accessible_symbol_chain_ex(parent, at, meaning.left(), visited)
                .is_empty(),
            None => false,
        }
    }

    /// `needsQualification`
    fn needs_qualification(&mut self, symbol: Sym, at: Enclosing, meaning: Meaning) -> bool {
        for table in self.tables_in_scope(at) {
            let Some(found) = self.lookup_symbol(table, symbol) else {
                continue;
            };
            let found = self.c.merged_symbol(found);
            if found == symbol {
                return false;
            }
            let flags = self.c.flags_of(found);
            let resolves_alias = flags.contains(SymFlags::ALIAS)
                && !self
                    .c
                    .decls_of(found)
                    .iter()
                    .any(|d| matches!(d.1, Decl::ExportSpec(_)));
            let flags = if resolves_alias {
                self.c.files().symbol_flags(found)
            } else {
                flags
            };
            if flags.intersects(meaning.flags()) {
                return true;
            }
        }
        false
    }

    /// `getAliasForSymbolInContainer`
    fn alias_for_symbol_in_container(&mut self, container: Sym, symbol: Sym) -> Option<Sym> {
        if Some(container) == self.c.parent_of_symbol(symbol) {
            return Some(symbol);
        }
        if container == self.c.files().global_this_symbol {
            return None;
        }
        if let Some(equals) = self.c.files().export(container, known::export_equals)
            && self.c.is_same_reference(equals, symbol)
        {
            return Some(container);
        }
        let exports = self.exports_of_symbol(container);
        let name = self.c.name_of(symbol);
        if let Some(quick) = exports.iter().find(|export| export.0 == name)
            && self.c.is_same_reference(quick.1, symbol)
        {
            return Some(quick.1);
        }
        let mut same = Vec::new();
        for &(_, exported) in exports.iter() {
            if self.c.is_same_reference(exported, symbol) {
                same.push(exported);
            }
        }
        same.into_iter()
            .min_by(|&a, &b| self.c.compare_symbols_of_chain(a, b))
    }

    /// `getAlternativeContainingModules`
    fn alternative_containing_modules(&mut self, symbol: Sym, at: Enclosing) -> Rc<Vec<Sym>> {
        if let Some(known) = self.links.containing_modules.get(&(symbol, at.file)) {
            return Rc::clone(known);
        }
        let files = self.c.files();
        let mut results = Vec::new();
        for &specifier in &self.c.bound(at.file).specifiers {
            if let Some(module) = files.module_of_specifier(at.file, specifier)
                && self.alias_for_symbol_in_container(module, symbol).is_some()
            {
                results.push(module);
            }
        }
        if results.is_empty() {
            for (index, module) in files.modules.iter().enumerate() {
                let file = FileId(index as u32);
                // What nothing refers to is only there while it is checked.
                if !module.hir.has_module_syntax || module.is_transient && !file.is_local() {
                    continue;
                }
                let module = files.file_symbol(file);
                if self.alias_for_symbol_in_container(module, symbol).is_some() {
                    results.push(module);
                }
            }
        }
        let results = Rc::new(results);
        self.links
            .containing_modules
            .insert((symbol, at.file), Rc::clone(&results));
        results
    }

    /// `getWithAlternativeContainers`
    fn with_alternative_containers(
        &mut self,
        container: Sym,
        symbol: Sym,
        at: Enclosing,
        meaning: Meaning,
    ) -> Vec<Sym> {
        // `getFileSymbolIfFileSymbolExportEqualsContainer`
        let mut additional = Vec::new();
        if let Some(module) = self.c.external_module_container_of_symbol(container)
            && let Some(equals) = self.c.files().export(module, known::export_equals)
            && self.c.is_same_reference(equals, container)
        {
            additional.push(module);
        }
        let reexports = self.alternative_containing_modules(symbol, at);
        let is_in_scope = self
            .c
            .flags_of(container)
            .intersects(meaning.left().flags())
            && !self
                .accessible_symbol_chain(container, at, Meaning::Namespace)
                .is_empty();
        let mut result = Vec::with_capacity(1 + additional.len() + reexports.len());
        // The real container comes first if it is in scope.
        if is_in_scope {
            result.push(container);
            result.extend(additional);
        } else {
            result.extend(additional);
            result.push(container);
        }
        result.extend(reexports.iter().copied());
        result
    }

    /// The part of `getContainersOfSymbol` for the class expression `e` on the right of `a.b = class ..`: the module for
    /// `module.exports = ..` and `exports.b = ..`, otherwise what `a` resolves to.
    fn container_of_assigned_class_expression(&self, file: FileId, e: ExprId) -> Option<Sym> {
        let (hir, bound, files) = (self.c.hir(file), self.c.bound(file), self.c.files());
        let Parent::Expr(assignment) = bound.expr_parent[e.idx()] else {
            return None;
        };
        if assignment.is_none() {
            return None;
        }
        let ExprKind::Assign {
            op: None,
            target,
            value,
        } = hir[assignment].kind
        else {
            return None;
        };
        if value != e
            || is_parenthesized(self.c.hir(file), e)
            || is_parenthesized(self.c.hir(file), target)
        {
            return None;
        }
        let (ExprKind::Dot { obj, .. } | ExprKind::Index { obj, .. }) = hir[target].kind else {
            return None;
        };
        if !is_entity_name_expression(self.c.hir(file), obj) {
            return None;
        }
        // `IsModuleExportsAccessExpression(left) || IsExportsIdentifier(left.Expression())`
        if crate::bind::is_module_exports(hir, target)
            || matches!(hir[obj].kind, ExprKind::Ident(known::exports))
        {
            return files
                .module(file)
                .is_module()
                .then(|| files.file_symbol(file));
        }
        match hir[obj].kind {
            ExprKind::Ident(name) => self.c.symbol_of_identifier(file, obj, name),
            _ => None,
        }
    }

    /// `getContainersOfSymbol`
    fn containers_of_symbol(&mut self, symbol: Sym, at: Enclosing, meaning: Meaning) -> Vec<Sym> {
        if let Some(container) = self.c.parent_of_symbol(symbol)
            && !self.c.flags_of(symbol).contains(SymFlags::TYPE_PARAMETER)
        {
            return self.with_alternative_containers(container, symbol, at, meaning);
        }
        let files = self.c.files();
        let mut candidates: Vec<Sym> = Vec::new();
        for (file, decl) in self.c.decls_of(symbol) {
            // `IsAmbientModule`
            if matches!(decl, Decl::Module(m) if !matches!(self.c.hir(file)[m].name, ModuleName::Ident(_)))
                || matches!(
                    decl,
                    Decl::ImportDefault(_)
                        | Decl::ImportNamespace(_)
                        | Decl::ImportSpec(_)
                        | Decl::ExportSpec(_)
                )
            {
                continue;
            }
            if let Decl::Class(class) = decl
                && let ClassOwner::Expr(e) = self.c.bound(file).class_owner[class.idx()]
            {
                if let Some(candidate) = self.container_of_assigned_class_expression(file, e)
                    && !candidates.contains(&candidate)
                {
                    candidates.push(candidate);
                }
                continue;
            }
            let Some(statement) = self.statement_of(file, decl) else {
                continue;
            };
            let bound = self.c.bound(file);
            let candidate = match bound.stmt_parent[statement.idx()] {
                // A direct child of a module.
                Parent::File if files.module(file).is_module() => files.file_symbol(file),
                Parent::Module(m) => {
                    let module = files.sym(file, bound.module_symbol[m.idx()]);
                    // What an ambient module says it is with `export =`.
                    if files.module_value(module) != symbol {
                        continue;
                    }
                    module
                }
                _ => continue,
            };
            if !candidates.contains(&candidate) {
                candidates.push(candidate);
            }
        }
        let (mut best, mut alternatives) = (Vec::new(), Vec::new());
        for container in candidates {
            if self
                .alias_for_symbol_in_container(container, symbol)
                .is_none()
            {
                continue;
            }
            let all = self.with_alternative_containers(container, symbol, at, meaning);
            if let Some((&first, rest)) = all.split_first() {
                best.push(first);
                alternatives.extend_from_slice(rest);
            }
        }
        best.extend(alternatives);
        best
    }

    /// `IsAnySymbolAccessible`. `paints`: `shouldComputeAliasesToMakeVisible`.
    fn is_any_symbol_accessible(
        &mut self,
        symbols: &[Sym],
        at: Enclosing,
        initial: Sym,
        meaning: Meaning,
        paints: bool,
        depth: u32,
    ) -> Option<Access> {
        if depth > 32 {
            return None;
        }
        let mut had_accessible_chain = None;
        let mut early_module_bail = false;
        for &symbol in symbols {
            let chain = self.accessible_symbol_chain(symbol, at, meaning);
            if let Some(&first) = chain.first() {
                had_accessible_chain = Some(symbol);
                if let Some(aliases) = self.has_visible_declarations(first, paints) {
                    return Some(Access::accessible(aliases));
                }
            }
            // Whatever a module means can be written as an `import` type.
            if self.c.is_external_module_symbol(symbol) {
                if paints {
                    early_module_bail = true;
                    continue;
                }
                return Some(Access::accessible(Vec::new()));
            }
            let containers = self.containers_of_symbol(symbol, at, meaning);
            let next = if initial == symbol {
                meaning.left()
            } else {
                meaning
            };
            let of_parent =
                self.is_any_symbol_accessible(&containers, at, initial, next, paints, depth + 1);
            if of_parent.is_some() {
                return of_parent;
            }
        }
        if early_module_bail {
            return Some(Access::accessible(Vec::new()));
        }
        let had = had_accessible_chain?;
        Some(Access {
            accessibility: Accessibility::NotAccessible,
            aliases: Vec::new(),
            symbol_name: self.c.symbol_text(initial),
            module_name: if had != initial {
                self.c.symbol_text(had)
            } else {
                String::new()
            },
            error_node: None,
        })
    }

    /// `IsSymbolAccessible`
    pub(super) fn is_symbol_accessible(
        &mut self,
        symbol: Sym,
        at: Enclosing,
        meaning: Meaning,
        paints: bool,
    ) -> Access {
        if let Some(result) =
            self.is_any_symbol_accessible(&[symbol], at, symbol, meaning, paints, 0)
        {
            return result;
        }
        self.inaccessible(symbol, at)
    }

    /// The end of `isSymbolAccessibleWorker`: `symbol` is not exported from its module, or is in another module and has no alias.
    fn inaccessible(&mut self, symbol: Sym, at: Enclosing) -> Access {
        let mut result = Access {
            accessibility: Accessibility::NotAccessible,
            aliases: Vec::new(),
            symbol_name: self.c.symbol_text(symbol),
            module_name: String::new(),
            error_node: None,
        };
        if let Some(module) = self.c.external_module_container_of_symbol(symbol)
            && Some(module) != self.c.external_module_container_of_scope(at)
        {
            result.accessibility = Accessibility::CannotBeNamed;
            result.module_name = self.c.symbol_text(module);
            // `ErrorNode`: `enclosingDeclaration`, if it is in JavaScript. A variable declaration is where the error is anyway.
            if self.c.hir(at.file).is_js && at.variable.is_none() && at.fake_scope == 0 {
                let start = self.c.skip_trivia_from(at.file, 0);
                result.error_node = Some((start, self.c.end_of_token_at(at.file, start)));
            }
        }
        result
    }
}

// ───────────────────────────── `SymbolTracker` ─────────────────────────────

impl SymbolTrackerImpl {
    fn text(&self, c: &Checker<'_>, range: (u32, u32)) -> String {
        c.source_text(self.current_source_file, range.0, range.1)
    }

    fn add_diagnostic(&mut self, range: (u32, u32), code: u32, args: Vec<String>) {
        self.diagnostics.push(Found {
            start: range.0,
            end: range.1,
            code,
            args,
            related: Vec::new(),
        });
    }

    /// Whether the member `m` is static, and whether it is written in a class declaration.
    fn place_of_member(&self, c: &Checker<'_>, m: MemberId) -> (bool, bool) {
        let (hir, bound) = (
            c.hir(self.current_source_file),
            c.bound(self.current_source_file),
        );
        let is_in_class_declaration = matches!(bound.member_owner[m.idx()], MemberOwner::Class(c)
            if matches!(bound.class_owner[c.idx()], ClassOwner::Stmt(_)));
        (
            hir[m].flags.contains(Flags::STATIC),
            is_in_class_declaration,
        )
    }

    fn name_range_of_member(&self, c: &Checker<'_>, m: MemberId) -> (u32, u32) {
        (
            c.hir(self.current_source_file)[m].pos,
            c.end_of_member_name(self.current_source_file, m),
        )
    }

    fn range_of_pat(&self, c: &Checker<'_>, pat: PatId) -> (u32, u32) {
        (
            c.hir(self.current_source_file)[pat].pos,
            c.end_of_pat(self.current_source_file, pat),
        )
    }

    /// `getSymbolAccessibilityDiagnostic`: the code, where the name the message starts with is written (nowhere if it starts with
    /// none), and where `GetErrorRangeForNode` puts the error. `None`: nothing is said.
    fn accessibility_diagnostic(
        &self,
        c: &Checker<'_>,
        access: &Access,
    ) -> Option<(u32, (u32, u32), (u32, u32))> {
        let (hir, bound) = (
            c.hir(self.current_source_file),
            c.bound(self.current_source_file),
        );
        let has_module = !access.module_name.is_empty();
        // `selectDiagnosticBasedOnModuleName`
        let by_module = |not_nameable: u32, private_module: u32, private_name: u32| {
            if !has_module {
                private_name
            } else if access.accessibility == Accessibility::CannotBeNamed {
                not_nameable
            } else {
                private_module
            }
        };
        // `selectDiagnosticBasedOnModuleNameNoNameCheck`
        let no_name_check = |private_module: u32, private_name: u32| {
            if has_module {
                private_module
            } else {
                private_name
            }
        };
        let of_property = |is_static: bool, is_in_class: bool| {
            if is_static {
                by_module(4026, 4027, 4028)
            } else if is_in_class {
                by_module(4029, 4030, 4031)
            } else {
                no_name_check(4032, 4033)
            }
        };
        Some(match self.get_symbol_accessibility_diagnostic {
            Context::None => return None,
            Context::Variable(pat) => {
                let name = self.range_of_pat(c, pat);
                (by_module(4023, 4024, 4025), name, name)
            }
            Context::Property(m) => {
                let (is_static, is_in_class) = self.place_of_member(c, m);
                let name = self.name_range_of_member(c, m);
                (
                    of_property(is_static, is_in_class),
                    name,
                    c.error_range_of_member(self.current_source_file, m),
                )
            }
            Context::Assignment(e) => {
                let name = match hir[e].kind {
                    ExprKind::Assign { target, .. } => match hir[target].kind {
                        ExprKind::Dot { name_pos, .. } => (
                            name_pos,
                            c.end_of_name_at(self.current_source_file, name_pos),
                        ),
                        _ => (0, 0),
                    },
                    _ => (0, 0),
                };
                (
                    of_property(false, false),
                    name,
                    (
                        c.start_of(self.current_source_file, e),
                        c.end_of_expr(self.current_source_file, e),
                    ),
                )
            }
            Context::ParameterProperty(p) => (
                of_property(false, true),
                self.range_of_pat(c, hir[p].pat),
                (hir[p].pos, c.end_of_param(self.current_source_file, p)),
            ),
            Context::Accessor(m) => {
                let (is_static, _) = self.place_of_member(c, m);
                let code = match (hir[m].kind == MemberKind::Setter, is_static) {
                    (true, true) => no_name_check(4034, 4035),
                    (true, false) => no_name_check(4036, 4037),
                    (false, true) => by_module(4038, 4039, 4040),
                    (false, false) => by_module(4041, 4042, 4043),
                };
                let name = self.name_range_of_member(c, m);
                (code, name, name)
            }
            Context::MethodName(m) => {
                let (is_static, is_in_class) = self.place_of_member(c, m);
                let code = if is_static {
                    by_module(4095, 4096, 4097)
                } else if is_in_class {
                    by_module(4098, 4099, 4100)
                } else {
                    no_name_check(4101, 4102)
                };
                (
                    code,
                    self.name_range_of_member(c, m),
                    c.error_range_of_member(self.current_source_file, m),
                )
            }
            Context::Return(f) => {
                let code = match hir[f].kind {
                    FnKind::ConstructSignature => no_name_check(4044, 4045),
                    FnKind::CallSignature => no_name_check(4046, 4047),
                    FnKind::IndexSignature => no_name_check(4048, 4049),
                    FnKind::Method => match bound.fns[f.idx()].owner {
                        FnOwner::Member(m) => match self.place_of_member(c, m) {
                            (true, _) => by_module(4050, 4051, 4052),
                            (false, true) => by_module(4053, 4054, 4055),
                            (false, false) => no_name_check(4056, 4057),
                        },
                        _ => return None,
                    },
                    FnKind::Decl => by_module(4058, 4059, 4060),
                    _ => return None,
                };
                // The name, or else the whole of it.
                let range = match bound.fns[f.idx()].owner {
                    FnOwner::Member(m) if hir[f].kind == FnKind::Method => {
                        self.name_range_of_member(c, m)
                    }
                    FnOwner::Member(m) => (hir[m].pos, hir[m].loc.end),
                    _ if hir[f].name.is_some() => (
                        hir[f].name_pos,
                        c.end_of_name_at(self.current_source_file, hir[f].name_pos),
                    ),
                    _ => c.error_range_of_fn(self.current_source_file, f),
                };
                (code, (0, 0), range)
            }
            Context::Parameter(p) => {
                let f = bound.param_fn[p.idx()];
                let code = match hir[f].kind {
                    FnKind::Constructor => by_module(4061, 4062, 4063),
                    FnKind::ConstructSignature | FnKind::ConstructorType => {
                        no_name_check(4064, 4065)
                    }
                    FnKind::CallSignature => no_name_check(4066, 4067),
                    FnKind::IndexSignature => no_name_check(4091, 4092),
                    FnKind::Method => match bound.fns[f.idx()].owner {
                        FnOwner::Member(m) => match self.place_of_member(c, m) {
                            (true, _) => by_module(4068, 4069, 4070),
                            (false, true) => by_module(4071, 4072, 4073),
                            (false, false) => no_name_check(4074, 4075),
                        },
                        _ => return None,
                    },
                    FnKind::Decl | FnKind::FunctionType => by_module(4076, 4077, 4078),
                    FnKind::Getter | FnKind::Setter => by_module(4108, 4107, 4106),
                    _ => return None,
                };
                (
                    code,
                    self.range_of_pat(c, hir[p].pat),
                    (hir[p].pos, c.end_of_param(self.current_source_file, p)),
                )
            }
            Context::TypeParameter(_, 0) => return None,
            Context::TypeParameter(tp, code) => {
                let start = hir[tp].pos;
                (
                    code,
                    (start, c.end_of_name_at(self.current_source_file, start)),
                    (start, c.end_of_type_param(self.current_source_file, tp)),
                )
            }
            Context::Heritage(code, name, node) => (code, name, node),
            Context::ImportEquals(i, statement) => (
                4000,
                (
                    hir[i].name_pos,
                    c.end_of_name_at(self.current_source_file, hir[i].name_pos),
                ),
                (
                    hir[statement].pos,
                    c.end_of_stmt(self.current_source_file, statement),
                ),
            ),
            Context::TypeAlias(a) => (
                no_name_check(4084, 4081),
                (
                    hir[a].name_pos,
                    c.end_of_name_at(self.current_source_file, hir[a].name_pos),
                ),
                (
                    hir[hir[a].ty].pos,
                    c.end_of_type_node(self.current_source_file, hir[a].ty),
                ),
            ),
            Context::DefaultExport(start, end) => (4082, (0, 0), (start, end)),
            Context::DefinedExport(e) => {
                let (_, key) = crate::bind::define_property_call(hir, e)?;
                let key = (
                    c.start_of(self.current_source_file, key),
                    c.end_of_expr(self.current_source_file, key),
                );
                (by_module(4023, 4024, 4025), key, key)
            }
        })
    }

    /// `handleSymbolAccessibilityError`. Whether an error is reported.
    fn handle_symbol_accessibility_error(&mut self, c: &Checker<'_>, access: Access) -> bool {
        match access.accessibility {
            Accessibility::Accessible => {
                for (file, statement) in access.aliases {
                    if file == self.current_source_file
                        && !self.late_marked_statements.contains(&statement)
                    {
                        self.late_marked_statements.push(statement);
                    }
                }
                return false;
            }
            // The checker says what it has to say of a name that means nothing.
            Accessibility::NotResolved => return false,
            Accessibility::NotAccessible | Accessibility::CannotBeNamed => {}
        }
        let Some((code, type_name, error_node)) = self.accessibility_diagnostic(c, &access) else {
            return false;
        };
        let mut args = Vec::with_capacity(3);
        if type_name != (0, 0) {
            args.push(self.text(c, type_name));
        }
        args.push(access.symbol_name);
        args.push(access.module_name);
        self.add_diagnostic(access.error_node.unwrap_or(error_node), code, args);
        true
    }

    /// `errorLocation`
    fn error_location(&self) -> Option<(u32, u32)> {
        match (self.error_name_node, self.fallback_stack.last()) {
            (Some(name), _) => Some((name.start, name.end)),
            (None, Some(node)) => Some((node.start, node.end)),
            (None, None) => None,
        }
    }

    /// `errorDeclarationNameWithFallback`
    fn error_declaration_name(&self, c: &Checker<'_>) -> String {
        match (self.error_name_node, self.fallback_stack.last()) {
            (Some(name), _) if name.start < name.end => self.text(c, (name.start, name.end)),
            (None, Some(node)) if node.name != (0, 0) => self.text(c, node.name),
            (None, Some(node)) => node.unnamed.to_owned(),
            _ => "(Missing)".to_owned(),
        }
    }
}

impl<'p> SymbolTracker<'p> for SymbolTrackerImpl {
    /// `TrackSymbol`
    fn track_symbol(
        &mut self,
        c: &mut Checker<'p>,
        symbol: Sym,
        enclosing_declaration: Option<Enclosing>,
        meaning: SymFlags,
    ) -> bool {
        let Some(at) = enclosing_declaration else {
            return false;
        };
        if c.flags_of(symbol).contains(SymFlags::TYPE_PARAMETER) {
            return false;
        }
        let is_declared_in_javascript = c
            .decls_of(symbol)
            .iter()
            .any(|declaration| c.hir(declaration.0).is_js);
        // How JavaScript exports what it declares is not followed: nothing is said of it.
        if is_declared_in_javascript && !c.is_symbol_accessible_at(symbol, meaning, false, at) {
            return true;
        }
        let meaning = Meaning::of(meaning, false);
        let access = c.with_emit_resolver(self.current_source_file, |resolver| {
            resolver.is_symbol_accessible(symbol, at, meaning, true)
        });
        self.handle_symbol_accessibility_error(c, access)
    }

    /// The six that `Report` stands for.
    fn report(&mut self, c: &mut Checker<'p>, report: Report) {
        let Some(location) = self.error_location() else {
            return;
        };
        let name = self.error_declaration_name(c);
        match report {
            Report::CyclicStructure => self.add_diagnostic(location, 5088, vec![name]),
            Report::InaccessibleThis => {
                self.add_diagnostic(location, 2527, vec![name, "this".to_owned()]);
            }
            Report::InaccessibleUniqueSymbol => {
                self.add_diagnostic(location, 2527, vec![name, "unique symbol".to_owned()]);
            }
            Report::LikelyUnsafeImportRequired(specifier, symbol) => {
                self.add_diagnostic(location, 2883, vec![name, specifier, symbol]);
            }
            Report::NonSerializableProperty(property) => {
                self.add_diagnostic(location, 4118, vec![property]);
            }
            Report::PrivateInBaseOfClassExpression(property) => {
                self.add_diagnostic(location, 4094, vec![property]);
                if self.error_name_node.is_some_and(|name| name.of_variable)
                    && let Some(found) = self.diagnostics.last_mut()
                {
                    found.related.push(Related {
                        at: Some((self.current_source_file, location.0, location.1)),
                        code: 9027,
                        args: vec![name],
                    });
                }
            }
        }
    }

    /// `ReportTruncationError`, which does not wait.
    fn report_truncation_error(&mut self, _: &mut Checker<'p>) {
        if let Some(location) = self.error_location() {
            self.add_diagnostic(location, 7056, Vec::new());
        }
    }

    /// `ReportInferenceFallback`: `if !s.state.isolatedDeclarations { return }`, and errors_isolated_declarations.rs has that case.
    fn report_inference_fallback(&mut self, _: &mut Checker<'p>, _: FileId, _: SyntaxNode) {}
}

// ───────────────────────────── `DeclarationTransformer` ─────────────────────────────

impl<'p> DeclarationEmit<'_, 'p> {
    /// `visitSourceFile`
    fn transform_source_file(&mut self) {
        self.precalculate_visibility();
        self.transform_expando_assignments();
        let hir = self.c.hir(self.file());
        for s in hir.ids(hir.body) {
            self.visit_statement(s);
        }
        self.transform_late_painted_statements();
    }

    /// `transformExpandoAssignment`, of each `f.name = value` that declares a property of a function. They come before all statements.
    fn transform_expando_assignments(&mut self) {
        let files = self.c.files();
        let (hir, bound) = (self.c.hir(self.file()), self.c.bound(self.file()));
        for &e in bound.expando_declarations.iter() {
            let ExprKind::Assign {
                op: None,
                target,
                value,
            } = hir[e].kind
            else {
                continue;
            };
            let ExprKind::Dot { obj, name, .. } = hir[target].kind else {
                continue;
            };
            let symbol = bound.expr_symbol[obj.idx()];
            if !matches!(hir[obj].kind, ExprKind::Ident(_))
                || symbol.is_none()
                || self.c.is_private_name(name)
            {
                continue;
            }
            // `GetReferencedValueDeclaration`
            let host = files.sym(self.file(), symbol);
            let decls = self.c.decls_of(host);
            let Some(&(file, decl)) = decls
                .iter()
                .find(|d| matches!(d.1, Decl::Fn(_) | Decl::Var(_)))
            else {
                continue;
            };
            if file != self.file() {
                continue;
            }
            if let Decl::Var(pat) = decl {
                let PatParent::Var(d) = bound.pat_parent[pat.idx()] else {
                    continue;
                };
                let declaration = hir[d];
                if declaration.ty.is_some()
                    || declaration.init.is_none()
                    || is_parenthesized(self.c.hir(file), declaration.init)
                {
                    continue;
                }
                let ExprKind::Fn(function) = hir[declaration.init].kind else {
                    continue;
                };
                if !self.is_binding_name_visible(pat) {
                    continue;
                }
                // `transformExpandoHost`: it is written as a function, in the place of the whole statement.
                let statement = bound.var_stmt[d.idx()];
                if statement.is_some() && self.written.insert(statement) {
                    let saved = self.tracker.get_symbol_accessibility_diagnostic;
                    self.tracker.get_symbol_accessibility_diagnostic = Context::Variable(pat);
                    self.transform_signature(function);
                    self.tracker.get_symbol_accessibility_diagnostic = saved;
                }
            } else {
                // `shouldEmitFunctionProperties`
                let has_body = decls.iter().any(|d| {
                    matches!(d.1, Decl::Fn(f)
                        if d.0 == file && !matches!(hir[f].body, FnBody::None))
                });
                if !has_body
                    || !self.with_resolver(|resolver| resolver.is_declaration_visible(file, decl))
                {
                    continue;
                }
            }
            let saved = (
                self.tracker.error_name_node,
                self.tracker.get_symbol_accessibility_diagnostic,
            );
            self.tracker.get_symbol_accessibility_diagnostic = Context::Assignment(e);
            if let ExprKind::Ident(right) = hir[value].kind
                && !is_parenthesized(self.c.hir(file), value)
            {
                // It is written `export { right as name }`.
                self.check_entity_name_visibility(right, hir[value].pos, Meaning::ValueOfName);
            } else {
                let function = self.c.type_of_symbol(host);
                if let Some(ty) = self.c.type_of_property(function, name) {
                    self.tracker.error_name_node = None;
                    self.create_type_of_declaration(None, ty, DECLARATION_EMIT_NODE_BUILDER_FLAGS);
                }
            }
            (
                self.tracker.error_name_node,
                self.tracker.get_symbol_accessibility_diagnostic,
            ) = saved;
        }
    }

    /// `PrecalculateDeclarationEmitVisibility`
    fn precalculate_visibility(&mut self) {
        let files = self.c.files();
        let (hir, bound) = (self.c.hir(self.file()), self.c.bound(self.file()));
        let any = SymFlags::VALUE | SymFlags::TYPE | SymFlags::NAMESPACE | SymFlags::ALIAS;
        for (i, statement) in hir.stmts.iter().enumerate() {
            if bound.stmt_parent[i] == Parent::None {
                continue;
            }
            match statement.kind {
                StmtKind::ExportDefault(e) | StmtKind::ExportAssign(e) => {
                    if let ExprKind::Ident(name) = hir[e].kind
                        && !is_parenthesized(self.c.hir(self.file()), e)
                        && let Some(&scope) = bound.expr_scope.get(&e)
                    {
                        self.mark_linked_aliases(files.resolve_name(self.file(), scope, name, any));
                    }
                }
                StmtKind::ExportNamed(export) if hir[export].spec.is_none() => {
                    let scope = bound.export_scope[export.idx()];
                    for spec in hir[export].items.iter() {
                        let target = files.resolve_name(self.file(), scope, hir[spec].local, any);
                        self.mark_linked_aliases(target);
                    }
                }
                // `isCommonJSModuleExports`
                StmtKind::Expr(e)
                    if bound.commonjs_indicator.is_some()
                        && bound.stmt_parent[i] == Parent::File
                        && matches!(
                            crate::bind::assignment_declaration_kind(hir, e),
                            crate::bind::JsDeclarationKind::ModuleExports
                                | crate::bind::JsDeclarationKind::ExportsProperty(_)
                        ) =>
                {
                    if let ExprKind::Assign { value, .. } = hir[e].kind
                        && let ExprKind::Ident(name) = hir[value].kind
                        && !is_parenthesized(self.c.hir(self.file()), value)
                    {
                        let target = files.resolve_name(self.file(), ScopeId(0), name, any);
                        self.mark_linked_aliases(target);
                    }
                }
                _ => {}
            }
        }
    }

    /// `visitSourceFile`, of JavaScript, as far as it is followed: the variables at the top of the file, and what
    /// `Object.defineProperty(exports, "name", descriptor)` exports. Of what may be wrong with them only a name that cannot be used
    /// outside of its module is told.
    fn transform_javascript_file(&mut self) {
        self.precalculate_visibility();
        self.transform_defined_exports();
        let hir = self.c.hir(self.file());
        for s in hir.ids(hir.body) {
            if matches!(hir[s].kind, StmtKind::Var(_)) {
                self.visit_statement(s);
            }
        }
        while !self.tracker.late_marked_statements.is_empty() {
            let next = self.tracker.late_marked_statements.remove(0);
            if matches!(hir[next].kind, StmtKind::Var(_)) {
                self.transform_top_level_declaration(next);
            }
        }
        self.tracker.diagnostics.retain(|found| found.code == 4023);
    }

    /// `transformCommonJSExport`, of each `Object.defineProperty(exports, "name", descriptor)` that is the first to export its name.
    fn transform_defined_exports(&mut self) {
        let files = self.c.files();
        if !files.module(self.file()).is_commonjs() {
            return;
        }
        let hir = self.c.hir(self.file());
        for (_, symbol) in files.exports(files.file_symbol(self.file())) {
            let Some(&(file, Decl::ExportsProperty(e))) = self.c.decls_of(symbol).first() else {
                continue;
            };
            if file != self.file() || crate::bind::define_property_call(hir, e).is_none() {
                continue;
            }
            let saved = (
                self.tracker.error_name_node,
                self.tracker.get_symbol_accessibility_diagnostic,
            );
            (
                self.tracker.error_name_node,
                self.tracker.get_symbol_accessibility_diagnostic,
            ) = (None, Context::DefinedExport(e));
            let ty = self.c.type_of_symbol(symbol);
            self.create_type_of_declaration(None, ty, DECLARATION_EMIT_NODE_BUILDER_FLAGS);
            (
                self.tracker.error_name_node,
                self.tracker.get_symbol_accessibility_diagnostic,
            ) = saved;
        }
    }

    /// `markLinkedAliases`
    fn mark_linked_aliases(&mut self, target: Option<Sym>) {
        let files = self.c.files();
        let any = SymFlags::VALUE | SymFlags::TYPE | SymFlags::NAMESPACE | SymFlags::ALIAS;
        let mut visited: Vec<Sym> = Vec::new();
        let mut at = target;
        while let Some(symbol) = at {
            if visited.contains(&symbol) {
                break;
            }
            visited.push(symbol);
            at = None;
            for (file, decl) in files.decls(symbol) {
                self.with_resolver(|resolver| resolver.links.paint_visible(file, decl));
                // `import a = b.c` makes `b` visible.
                if let Decl::ImportEquals(i) = decl
                    && let ImportEqualsTarget::Entity(names) = self.c.hir(file)[i].target
                    && !names.is_empty()
                {
                    let scope = self.c.bound(file).import_equals_scope[i.idx()];
                    at = files.resolve_name(file, scope, self.c.hir(file).id_at(names, 0), any);
                }
            }
        }
    }

    /// `visit`, of a statement.
    fn visit_statement(&mut self, s: StmtId) {
        let statement = &self.c.hir(self.file())[s];
        // `visitDeclarationStatements`
        if self.c.should_strip_internal(self.file(), statement.loc.pos) {
            return;
        }
        match statement.kind {
            StmtKind::ExportDefault(e) => self.transform_export_assignment(s, e, false),
            StmtKind::ExportAssign(e) => self.transform_export_assignment(s, e, true),
            StmtKind::Fn(_)
            | StmtKind::Class(_)
            | StmtKind::Interface(_)
            | StmtKind::TypeAlias(_)
            | StmtKind::Enum(_)
            | StmtKind::Module(_)
            | StmtKind::Var(_)
            | StmtKind::ImportEquals(_) => {
                if !self.written.contains(&s) && self.transform_top_level_declaration(s) {
                    self.written.insert(s);
                }
            }
            _ => {}
        }
    }

    /// `transformAndReplaceLatePaintedStatements`
    fn transform_late_painted_statements(&mut self) {
        while !self.tracker.late_marked_statements.is_empty() {
            let next = self.tracker.late_marked_statements.remove(0);
            if self.transform_top_level_declaration(next) {
                self.written.insert(next);
            } else {
                self.written.remove(&next);
            }
        }
    }

    /// Makes `scope` what names are looked up from.
    fn enter(&mut self, scope: ScopeId) {
        if scope.is_some() {
            self.enclosing = Enclosing::at_scope(self.file(), scope);
        }
    }

    /// `transformTopLevelDeclaration`. Whether anything is written for the statement.
    fn transform_top_level_declaration(&mut self, s: StmtId) -> bool {
        self.tracker
            .late_marked_statements
            .retain(|&marked| marked != s);
        let (hir, bound) = (self.c.hir(self.file()), self.c.bound(self.file()));
        if self.c.should_strip_internal(self.file(), hir[s].loc.pos) {
            return false;
        }
        let kind = hir[s].kind;
        let decl = match kind {
            StmtKind::ImportEquals(i) => return self.transform_import_equals(i, s),
            StmtKind::Fn(f) => Some(Decl::Fn(f)),
            StmtKind::Class(c) => Some(Decl::Class(c)),
            StmtKind::Interface(i) => Some(Decl::Interface(i)),
            StmtKind::TypeAlias(a) => Some(Decl::Alias(a)),
            StmtKind::Enum(e) => Some(Decl::Enum(e)),
            StmtKind::Module(m) => Some(Decl::Module(m)),
            StmtKind::Var(_) => None,
            _ => return false,
        };
        let file = self.file();
        if let Some(decl) = decl
            && !self.with_resolver(|resolver| resolver.is_declaration_visible(file, decl))
        {
            return false;
        }
        if let StmtKind::Fn(f) = kind
            && self.is_implementation_of_overload(f)
        {
            return false;
        }
        let saved = (
            self.enclosing,
            self.tracker.get_symbol_accessibility_diagnostic,
            self.tracker.error_name_node,
        );
        let is_written = match kind {
            StmtKind::TypeAlias(a) => {
                self.enter(bound.alias_scope[a.idx()]);
                self.tracker.get_symbol_accessibility_diagnostic = Context::TypeAlias(a);
                for tp in hir[a].type_params.iter() {
                    self.visit_type_parameter(tp, 4083);
                }
                self.visit_type(hir[a].ty, true);
                true
            }
            StmtKind::Interface(i) => {
                self.enter(self.interface_scopes[i.idx()]);
                for tp in hir[i].type_params.iter() {
                    self.visit_type_parameter(tp, 4004);
                }
                let name = (
                    hir[i].name_pos,
                    self.c.end_of_name_at(self.file(), hir[i].name_pos),
                );
                for node in hir.ids(hir[i].extends) {
                    self.visit_heritage_type(node, 4022, name);
                }
                for m in hir[i].members.iter() {
                    self.visit_member(m);
                }
                true
            }
            StmtKind::Fn(f) => {
                self.enter(bound.fns[f.idx()].scope);
                self.tracker.get_symbol_accessibility_diagnostic = Context::Return(f);
                self.transform_signature(f);
                true
            }
            StmtKind::Module(m) => {
                self.enter(self.module_scopes[m.idx()]);
                for inner in hir.ids(hir[m].body) {
                    self.visit_statement(inner);
                }
                self.transform_late_painted_statements();
                true
            }
            StmtKind::Class(c) => {
                self.transform_class_declaration(c, s);
                true
            }
            StmtKind::Var(decls) => self.transform_variable_statement(decls, s),
            _ => true,
        };
        (
            self.enclosing,
            self.tracker.get_symbol_accessibility_diagnostic,
            self.tracker.error_name_node,
        ) = saved;
        is_written
    }

    /// `transformImportEqualsDeclaration`
    fn transform_import_equals(&mut self, i: ImportEqualsId, s: StmtId) -> bool {
        let file = self.file();
        if !self
            .with_resolver(|resolver| resolver.is_declaration_visible(file, Decl::ImportEquals(i)))
        {
            return false;
        }
        let hir = self.c.hir(self.file());
        if let ImportEqualsTarget::Entity(names) = hir[i].target
            && !names.is_empty()
        {
            let saved = self.tracker.get_symbol_accessibility_diagnostic;
            self.tracker.get_symbol_accessibility_diagnostic = Context::ImportEquals(i, s);
            // The name comes after the `=`.
            let after_name = self.c.end_of_name_at(self.file(), hir[i].name_pos);
            let equals = self.c.skip_trivia_from(self.file(), after_name);
            let start = self.c.skip_trivia_from(self.file(), equals + 1);
            self.check_entity_name_visibility(hir.id_at(names, 0), start, Meaning::Namespace);
            self.tracker.get_symbol_accessibility_diagnostic = saved;
        }
        true
    }

    /// `getBindingNameVisible`
    fn is_binding_name_visible(&mut self, pat: PatId) -> bool {
        let file = self.file();
        let hir = self.c.hir(file);
        match hir[pat].kind {
            PatKind::Missing => false,
            PatKind::Ident(_) => {
                self.with_resolver(|resolver| resolver.is_declaration_visible(file, Decl::Var(pat)))
            }
            PatKind::Object(props) => props
                .iter()
                .any(|p| self.is_binding_name_visible(hir[p].value)),
            PatKind::Array(elems) => elems
                .iter()
                .any(|e| self.is_binding_name_visible(hir[e].pat)),
        }
    }

    /// `transformVariableStatement`
    fn transform_variable_statement(&mut self, decls: Span<VarDeclId>, s: StmtId) -> bool {
        let (hir, bound) = (self.c.hir(self.file()), self.c.bound(self.file()));
        if !decls
            .iter()
            .any(|d| self.is_binding_name_visible(hir[d].pat))
        {
            return false;
        }
        let scope = match bound.stmt_parent[s.idx()] {
            Parent::File => ScopeId(0),
            Parent::Module(m) => self.module_scopes[m.idx()],
            _ => self.enclosing.scope,
        };
        let is_commonjs = bound.commonjs_indicator.is_some();
        for d in decls.iter() {
            let pat = hir[d].pat;
            if !self.is_binding_name_visible(pat) {
                continue;
            }
            // `transformCjsRequireVariableDeclaration`: it is written as an import. What JSDoc says of a type is not gone through.
            if hir.is_js
                && (hir[d].ty.is_some()
                    || is_commonjs
                        && hir[d].init.is_some()
                        && crate::bind::required_specifier(hir, hir[d].init).is_some())
            {
                continue;
            }
            let saved = (
                self.enclosing,
                self.tracker.get_symbol_accessibility_diagnostic,
                self.tracker.error_name_node,
                self.suppresses_new_contexts,
            );
            self.enclosing = Enclosing {
                variable: d,
                ..Enclosing::at_scope(self.file(), scope)
            };
            if !self.suppresses_new_contexts {
                self.tracker.get_symbol_accessibility_diagnostic = Context::Variable(pat);
            }
            if matches!(hir[pat].kind, PatKind::Ident(_)) {
                self.suppresses_new_contexts = true;
                self.ensure_type(Typed::Variable(d), false);
            } else {
                self.recreate_binding_pattern(pat, true);
            }
            (
                self.enclosing,
                self.tracker.get_symbol_accessibility_diagnostic,
                self.tracker.error_name_node,
                self.suppresses_new_contexts,
            ) = saved;
        }
        true
    }

    /// `recreateBindingPattern`, and `walkBindingPattern`, which does not ask what is visible.
    fn recreate_binding_pattern(&mut self, pat: PatId, only_visible: bool) {
        let hir = self.c.hir(self.file());
        let elements: Vec<PatId> = match hir[pat].kind {
            PatKind::Object(props) => props.iter().map(|p| hir[p].value).collect(),
            PatKind::Array(elems) => elems.iter().map(|e| hir[e].pat).collect(),
            _ => return,
        };
        for element in elements {
            if only_visible && !self.is_binding_name_visible(element) {
                continue;
            }
            match hir[element].kind {
                PatKind::Missing => {}
                PatKind::Ident(_) => self.ensure_type(Typed::Element(element), false),
                _ => self.recreate_binding_pattern(element, only_visible),
            }
        }
    }

    /// `transformClassDeclaration`
    fn transform_class_declaration(&mut self, c: ClassId, s: StmtId) {
        let (hir, bound) = (self.c.hir(self.file()), self.c.bound(self.file()));
        let class = hir[c];
        self.enter(bound.class_scope[c.idx()]);
        let name = if class.name.is_some() {
            (
                class.name_pos,
                self.c.end_of_name_at(self.file(), class.name_pos),
            )
        } else {
            (0, 0)
        };
        self.tracker.error_name_node = class.name.is_some().then_some(NameNode {
            start: name.0,
            end: name.1,
            of_variable: false,
        });
        let (start, end) = self.c.error_range_of_stmt(self.file(), s);
        self.tracker.fallback_stack.push(FallbackNode {
            start,
            end,
            name,
            unnamed: "(Missing)",
        });
        for tp in class.type_params.iter() {
            self.visit_type_parameter(tp, 4002);
        }
        self.build_class_members(c);
        self.visit_class_heritage(c, name, true);
        self.tracker.fallback_stack.pop();
    }

    /// `transformClassExpressionToDeclaration`
    fn transform_class_expression(&mut self, c: ClassId) {
        let (hir, bound) = (self.c.hir(self.file()), self.c.bound(self.file()));
        let class = hir[c];
        let saved = (self.enclosing, self.in_class_expression);
        self.enter(bound.class_scope[c.idx()]);
        self.in_class_expression = true;
        self.build_class_members(c);
        for tp in class.type_params.iter() {
            self.visit_type_parameter(tp, 0);
        }
        let name = if class.name.is_some() {
            (
                class.name_pos,
                self.c.end_of_name_at(self.file(), class.name_pos),
            )
        } else {
            (0, 0)
        };
        self.visit_class_heritage(c, name, false);
        (self.enclosing, self.in_class_expression) = saved;
    }

    /// `buildClassMembers`
    fn build_class_members(&mut self, c: ClassId) {
        let hir = self.c.hir(self.file());
        let members = hir[c].members;
        // `GetFirstConstructorWithBody`
        let constructor = members.iter().find(|&m| {
            hir[m].kind == MemberKind::Constructor
                && hir[m].func.is_some()
                && !matches!(hir[hir[m].func].body, FnBody::None)
        });
        if let Some(constructor) = constructor {
            let saved = self.tracker.get_symbol_accessibility_diagnostic;
            for p in hir[hir[constructor].func].params.iter() {
                if !hir[p].flags.contains(Flags::PARAMETER_PROPERTY) {
                    continue;
                }
                self.tracker.get_symbol_accessibility_diagnostic = self.context_of_parameter(p);
                match hir[hir[p].pat].kind {
                    PatKind::Ident(_) => self.ensure_type(Typed::Parameter(p), false),
                    _ => self.recreate_binding_pattern(hir[p].pat, false),
                }
            }
            self.tracker.get_symbol_accessibility_diagnostic = saved;
        }
        for m in members.iter() {
            self.visit_member(m);
        }
    }

    /// The heritage clauses of a class whose name is written at `name`. `is_declaration`: what it extends is written as a variable
    /// of its type if it is no name.
    fn visit_class_heritage(&mut self, c: ClassId, name: (u32, u32), is_declaration: bool) {
        let hir = self.c.hir(self.file());
        let class = hir[c];
        if class.extends.is_some() {
            let node = (
                self.c.start_of(self.file(), class.extends),
                self.c.end_of_class_extends(self.file(), c),
            );
            if is_entity_name_expression(self.c.hir(self.file()), class.extends) {
                let saved = self.tracker.get_symbol_accessibility_diagnostic;
                if !self.suppresses_new_contexts {
                    let code = match (is_declaration, name != (0, 0)) {
                        (false, _) => 4022,
                        (true, true) => 4020,
                        (true, false) => 4021,
                    };
                    self.tracker.get_symbol_accessibility_diagnostic =
                        Context::Heritage(code, name, node);
                }
                if let Some((first, start)) = self.c.first_identifier(self.file(), class.extends) {
                    self.check_entity_name_visibility(first, start, Meaning::ValueOfName);
                }
                for argument in hir.ids(class.extends_args) {
                    self.visit_type(argument, false);
                }
                self.tracker.get_symbol_accessibility_diagnostic = saved;
            } else if is_declaration && !matches!(hir[class.extends].kind, ExprKind::Null) {
                self.tracker.get_symbol_accessibility_diagnostic =
                    Context::Heritage(4020, name, node);
                self.create_type_of_expression(class.extends);
                for argument in hir.ids(class.extends_args) {
                    self.visit_type(argument, false);
                }
            }
        }
        let code = if is_declaration { 4019 } else { 4022 };
        for node in hir.ids(class.implements) {
            self.visit_heritage_type(node, code, name);
        }
    }

    /// `transformExpressionWithTypeArguments`, of what a class implements or an interface extends.
    fn visit_heritage_type(&mut self, node: TypeNodeId, code: u32, name: (u32, u32)) {
        let saved = self.tracker.get_symbol_accessibility_diagnostic;
        if !self.suppresses_new_contexts {
            let range = (
                self.c.hir(self.file())[node].pos,
                self.c.end_of_type_node(self.file(), node),
            );
            self.tracker.get_symbol_accessibility_diagnostic = Context::Heritage(code, name, range);
        }
        self.visit_type(node, false);
        self.tracker.get_symbol_accessibility_diagnostic = saved;
    }

    /// `transformExportAssignment`
    fn transform_export_assignment(&mut self, s: StmtId, e: ExprId, is_export_equals: bool) {
        let (hir, bound) = (self.c.hir(self.file()), self.c.bound(self.file()));
        if matches!(hir[e].kind, ExprKind::Ident(_))
            && !is_parenthesized(self.c.hir(self.file()), e)
            && matches!(bound.stmt_parent[s.idx()], Parent::File | Parent::Module(_))
        {
            return;
        }
        // `SkipOuterExpressions(expression, OEKExpressionTypePassthrough)`
        let mut unwrapped = e;
        loop {
            unwrapped = match hir[unwrapped].kind {
                ExprKind::Assign {
                    op: None, value, ..
                } => value,
                ExprKind::Binary {
                    op: BinOp::Comma,
                    right,
                    ..
                } => right,
                _ => break,
            };
        }
        match hir[unwrapped].kind {
            ExprKind::Class(c) => return self.transform_class_expression(c),
            ExprKind::Fn(f) => return self.transform_signature(f),
            _ => {}
        }
        let (start, end) = (hir[s].pos, self.c.end_of_stmt(self.file(), s));
        self.tracker.get_symbol_accessibility_diagnostic = Context::DefaultExport(start, end);
        // `IsPrimitiveLiteralValue`: it is written as it is.
        let is_literal = match hir[e].kind {
            ExprKind::True
            | ExprKind::False
            | ExprKind::Number(_)
            | ExprKind::String(_)
            | ExprKind::BigInt(_) => true,
            ExprKind::Template { exprs, .. } => exprs.is_empty(),
            ExprKind::Unary {
                op: UnOp::Minus,
                operand,
            } => matches!(hir[operand].kind, ExprKind::Number(_) | ExprKind::BigInt(_)),
            ExprKind::Unary {
                op: UnOp::Plus,
                operand,
            } => matches!(hir[operand].kind, ExprKind::Number(_)),
            _ => false,
        };
        if is_literal {
            return;
        }
        self.tracker.fallback_stack.push(FallbackNode {
            start,
            end,
            name: (0, 0),
            unnamed: if is_export_equals {
                "export="
            } else {
                "default"
            },
        });
        self.ensure_type(Typed::Export(s, e), false);
        self.tracker.fallback_stack.pop();
    }

    // ───────────────────────────── members and signatures ─────────────────────────────

    /// `IsImplementationOfOverload`
    fn is_implementation_of_overload(&self, f: FnId) -> bool {
        let files = self.c.files();
        let (hir, bound) = (self.c.hir(self.file()), self.c.bound(self.file()));
        if matches!(hir[f].body, FnBody::None) {
            return false;
        }
        match bound.fns[f.idx()].owner {
            FnOwner::Stmt(_) => {
                let symbol = bound.fn_symbol[f.idx()];
                symbol.is_some()
                    && files
                        .decls_of(files.sym(self.file(), symbol))
                        .iter()
                        .filter(|d| matches!(d.1, Decl::Fn(_)))
                        .count()
                        > 1
            }
            FnOwner::Member(m) => {
                let MemberOwner::Class(c) = bound.member_owner[m.idx()] else {
                    return false;
                };
                let member = hir[m];
                hir[c]
                    .members
                    .iter()
                    .filter(|&other| {
                        let other = &hir[other];
                        other.kind == member.kind
                            && other.key == member.key
                            && other.flags.contains(Flags::STATIC)
                                == member.flags.contains(Flags::STATIC)
                    })
                    .count()
                    > 1
            }
            _ => false,
        }
    }

    /// `GetEffectiveDeclarationFlags(node, ModifierFlagsPrivate) != 0`, of what has parameters.
    fn is_private_function(&self, f: FnId) -> bool {
        match self.c.bound(self.file()).fns[f.idx()].owner {
            FnOwner::Member(m) => self.c.hir(self.file())[m].flags.contains(Flags::PRIVATE),
            _ => false,
        }
    }

    /// `createGetSymbolAccessibilityDiagnosticForNode`, of a parameter.
    fn context_of_parameter(&self, p: ParamId) -> Context {
        let (hir, bound) = (self.c.hir(self.file()), self.c.bound(self.file()));
        let f = bound.param_fn[p.idx()];
        if hir[p].flags.contains(Flags::PARAMETER_PROPERTY)
            && hir[f].kind == FnKind::Constructor
            && self.is_private_function(f)
        {
            Context::ParameterProperty(p)
        } else {
            Context::Parameter(p)
        }
    }

    /// `getTypeParameterConstraintVisibilityDiagnosticMessage`, of a type parameter of `f`. 0: there is none.
    fn type_parameter_code(&self, f: FnId) -> u32 {
        match self.c.hir(self.file())[f].kind {
            FnKind::ConstructorType | FnKind::ConstructSignature => 4006,
            FnKind::CallSignature => 4008,
            FnKind::Method => match self.c.bound(self.file()).fns[f.idx()].owner {
                FnOwner::Member(m) => match self.tracker.place_of_member(self.c, m) {
                    (true, _) => 4010,
                    (false, true) => 4012,
                    (false, false) => 4014,
                },
                _ => 0,
            },
            FnKind::FunctionType | FnKind::Decl => 4016,
            _ => 0,
        }
    }

    /// `ensureTypeParams`, `updateParamList`, `ensureType`
    fn transform_signature(&mut self, f: FnId) {
        if !self.is_private_function(f) {
            let code = self.type_parameter_code(f);
            for tp in self.c.hir(self.file())[f].type_params.iter() {
                self.visit_type_parameter(tp, code);
            }
        }
        self.update_param_list(f);
        self.ensure_type(Typed::Signature(f), false);
    }

    /// `updateParamList`
    fn update_param_list(&mut self, f: FnId) {
        if self.is_private_function(f) {
            return;
        }
        let function = self.c.hir(self.file())[f];
        self.visit_type(function.this_ty(self.c.hir(self.file())), false);
        for p in function.params.iter() {
            self.ensure_parameter(p);
        }
    }

    /// `ensureParameter`
    fn ensure_parameter(&mut self, p: ParamId) {
        let saved = self.tracker.get_symbol_accessibility_diagnostic;
        if !self.suppresses_new_contexts {
            self.tracker.get_symbol_accessibility_diagnostic = self.context_of_parameter(p);
        }
        self.visit_binding_name(self.c.hir(self.file())[p].pat);
        self.ensure_type(Typed::Parameter(p), true);
        self.tracker.get_symbol_accessibility_diagnostic = saved;
    }

    /// `visitBindingName`
    fn visit_binding_name(&mut self, pat: PatId) {
        let hir = self.c.hir(self.file());
        match hir[pat].kind {
            PatKind::Object(props) => {
                for p in props.iter() {
                    if let PropKey::Computed(key) = hir[p].key
                        && is_entity_name_expression(self.c.hir(self.file()), key)
                        && let Some((first, start)) = self.c.first_identifier(self.file(), key)
                    {
                        self.check_entity_name_visibility(first, start, Meaning::ValueOfName);
                    }
                    self.visit_binding_name(hir[p].value);
                }
            }
            PatKind::Array(elems) => {
                for e in elems.iter() {
                    self.visit_binding_name(hir[e].pat);
                }
            }
            PatKind::Ident(_) | PatKind::Missing => {}
        }
    }

    /// `visitDeclarationSubtree`, of a type parameter. `code`: of the error if what it extends cannot be named.
    fn visit_type_parameter(&mut self, tp: TypeParamId, code: u32) {
        let saved = self.tracker.get_symbol_accessibility_diagnostic;
        if !self.suppresses_new_contexts {
            self.tracker.get_symbol_accessibility_diagnostic = Context::TypeParameter(tp, code);
        }
        let parameter = self.c.hir(self.file())[tp];
        self.visit_type(parameter.constraint, false);
        self.visit_type(parameter.default, false);
        self.tracker.get_symbol_accessibility_diagnostic = saved;
    }

    /// `visitDeclarationSubtree`, of a member of a class, an interface or a type literal.
    fn visit_member(&mut self, m: MemberId) {
        let (hir, bound) = (self.c.hir(self.file()), self.c.bound(self.file()));
        let member = hir[m];
        if self.c.should_strip_internal(self.file(), member.loc.pos) {
            return;
        }
        let f = member.func;
        if member.kind == MemberKind::StaticBlock
            || f.is_none() && member.kind != MemberKind::Property
        {
            return;
        }
        // `HasDynamicName`: `[-1]` is none.
        let dynamic_name = match member.key {
            PropKey::Computed(key)
                if !matches!(
                    hir[key].kind,
                    ExprKind::Unary {
                        op: UnOp::Minus | UnOp::Plus,
                        operand
                    } if matches!(hir[operand].kind, ExprKind::Number(_))
                ) =>
            {
                Some(key)
            }
            _ => None,
        };
        // `IsLateBound`
        if let Some(key) = dynamic_name
            && !(is_entity_name_expression(self.c.hir(self.file()), key)
                && self.c.member_name(self.file(), member.key).is_some())
        {
            return;
        }
        if f.is_some()
            && !matches!(member.kind, MemberKind::Getter | MemberKind::Setter)
            && self.is_implementation_of_overload(f)
        {
            return;
        }
        let saved = (
            self.enclosing,
            self.tracker.get_symbol_accessibility_diagnostic,
            self.tracker.error_name_node,
            self.suppresses_new_contexts,
        );
        if f.is_some() {
            self.enter(bound.fns[f.idx()].scope);
        }
        if !self.suppresses_new_contexts {
            self.tracker.get_symbol_accessibility_diagnostic = match member.kind {
                MemberKind::Property => Context::Property(m),
                MemberKind::Getter | MemberKind::Setter => Context::Accessor(m),
                MemberKind::Constructor => Context::None,
                _ => Context::Return(f),
            };
        }
        let is_private = member.flags.contains(Flags::PRIVATE);
        let is_written = !matches!(member.key, PropKey::Private(_));
        if is_written {
            match member.kind {
                MemberKind::Property => self.ensure_type(Typed::Property(m), false),
                // `omitPrivateMethodType`
                MemberKind::Method if is_private => {}
                MemberKind::Method | MemberKind::CallSignature | MemberKind::ConstructSignature => {
                    self.transform_signature(f)
                }
                MemberKind::Constructor => self.update_param_list(f),
                MemberKind::Getter => {
                    if !is_private {
                        self.visit_type(hir[f].this_ty(hir), false);
                    }
                    self.ensure_type(Typed::Signature(f), false);
                }
                // `updateAccessorParamList`
                MemberKind::Setter => {
                    if !is_private {
                        self.visit_type(hir[f].this_ty(hir), false);
                        if let Some(value) = hir[f].params.iter().next() {
                            self.ensure_parameter(value);
                        }
                    }
                }
                MemberKind::IndexSignature => {
                    self.visit_type(hir[f].ret, false);
                    self.update_param_list(f);
                }
                MemberKind::StaticBlock => {}
            }
        }
        // `checkName`
        if is_written
            && let Some(key) = dynamic_name
            && let Some((first, start)) = self.c.first_identifier(self.file(), key)
        {
            if !self.suppresses_new_contexts {
                self.tracker.get_symbol_accessibility_diagnostic = match member.kind {
                    MemberKind::Getter | MemberKind::Setter => Context::Property(m),
                    MemberKind::Method => Context::MethodName(m),
                    _ => self.tracker.get_symbol_accessibility_diagnostic,
                };
            }
            self.check_entity_name_visibility(first, start, Meaning::ValueOfName);
        }
        (
            self.enclosing,
            self.tracker.get_symbol_accessibility_diagnostic,
            self.tracker.error_name_node,
            self.suppresses_new_contexts,
        ) = saved;
    }

    // ───────────────────────────── types that are written ─────────────────────────────

    /// `checkEntityNameVisibility`
    fn check_entity_name_visibility(&mut self, first: Atom, start: u32, meaning: Meaning) {
        let at = self.enclosing;
        let access = self.with_resolver(|resolver| {
            resolver.is_entity_name_visible(first, Some(start), meaning, at, true)
        });
        self.tracker
            .handle_symbol_accessibility_error(self.c, access);
    }

    /// `visitDeclarationSubtree`, of a type. `is_alias_body`: it is all a type alias stands for.
    fn visit_type(&mut self, node: TypeNodeId, is_alias_body: bool) {
        if node.is_none() || self.c.is_stack_low() {
            return;
        }
        let (hir, bound) = (self.c.hir(self.file()), self.c.bound(self.file()));
        match hir[node].kind {
            TypeNodeKind::Ref { name, args } => {
                if !name.is_empty() {
                    let meaning = if name.len() == 1 {
                        Meaning::Type
                    } else {
                        Meaning::Namespace
                    };
                    self.check_entity_name_visibility(hir.id_at(name, 0), hir[node].pos, meaning);
                }
                for argument in hir.ids(args) {
                    self.visit_type(argument, false);
                }
            }
            TypeNodeKind::Typeof { args, expr, .. } => {
                if expr.is_some()
                    && let Some((first, start)) = self.c.first_identifier(self.file(), expr)
                {
                    self.check_entity_name_visibility(first, start, Meaning::ValueOfName);
                }
                for argument in hir.ids(args) {
                    self.visit_type(argument, false);
                }
            }
            TypeNodeKind::Import { args, .. } => {
                for argument in hir.ids(args) {
                    self.visit_type(argument, false);
                }
            }
            TypeNodeKind::Template { types, .. }
            | TypeNodeKind::Union(types)
            | TypeNodeKind::Intersection(types) => {
                for ty in hir.ids(types) {
                    self.visit_type(ty, false);
                }
            }
            TypeNodeKind::Array(of) | TypeNodeKind::Keyof(of) | TypeNodeKind::Readonly(of) => {
                self.visit_type(of, false);
            }
            TypeNodeKind::Tuple(elems) => {
                for elem in elems.iter() {
                    self.visit_type(hir[elem].ty, false);
                }
            }
            TypeNodeKind::Fn(f) => {
                let saved = self.enclosing;
                self.enter(bound.fns[f.idx()].scope);
                let code = self.type_parameter_code(f);
                for tp in hir[f].type_params.iter() {
                    self.visit_type_parameter(tp, code);
                }
                self.update_param_list(f);
                self.visit_type(hir[f].ret, false);
                self.enclosing = saved;
            }
            TypeNodeKind::Object(members) => {
                let saved = self.suppresses_new_contexts;
                self.suppresses_new_contexts |= !is_alias_body;
                for m in members.iter() {
                    self.visit_member(m);
                }
                self.suppresses_new_contexts = saved;
            }
            TypeNodeKind::Cond {
                check,
                extends,
                yes,
                no,
            } => {
                self.visit_type(check, false);
                self.visit_type(extends, false);
                let saved = self.enclosing;
                self.enter(bound.type_scope[yes.idx()]);
                self.visit_type(yes, false);
                self.enclosing = saved;
                self.visit_type(no, false);
            }
            TypeNodeKind::Infer(tp) => self.visit_type_parameter(tp, 4085),
            TypeNodeKind::Mapped(m) => {
                let mapped = hir[m];
                let saved = (self.enclosing, self.suppresses_new_contexts);
                self.enter(bound.type_param_scope[mapped.param.idx()]);
                self.suppresses_new_contexts |= !is_alias_body;
                self.visit_type(mapped.ty, false);
                self.visit_type_parameter(mapped.param, 4103);
                self.visit_type(mapped.name_ty, false);
                (self.enclosing, self.suppresses_new_contexts) = saved;
            }
            TypeNodeKind::IndexedAccess { obj, index } => {
                self.visit_type(obj, false);
                self.visit_type(index, false);
            }
            TypeNodeKind::Predicate { ty, .. } => self.visit_type(ty, false),
            TypeNodeKind::Error
            | TypeNodeKind::Heritage(_)
            | TypeNodeKind::Keyword(_)
            | TypeNodeKind::StringLit(_)
            | TypeNodeKind::NumberLit(_)
            | TypeNodeKind::BigIntLit { .. }
            | TypeNodeKind::BoolLit(_)
            | TypeNodeKind::UniqueSymbol => {}
        }
    }

    // ───────────────────────────── types that are not ─────────────────────────────

    /// `isOptionalParameter`
    fn is_optional_parameter(&self, file: FileId, p: ParamId) -> bool {
        let (hir, bound) = (self.c.hir(file), self.c.bound(file));
        if hir[p].flags.contains(Flags::OPTIONAL) {
            return true;
        }
        // One with an initializer can be left out if none after it has to be given.
        hir[p].default.is_some()
            && !hir[bound.param_fn[p.idx()]].params.iter().any(|other| {
                other.0 > p.0
                    && !hir[other].flags.intersects(Flags::OPTIONAL | Flags::REST)
                    && hir[other].default.is_none()
            })
    }

    /// `requiresAddingImplicitUndefined`, of a parameter.
    fn requires_adding_implicit_undefined(
        &mut self,
        file: FileId,
        p: ParamId,
        at: Enclosing,
    ) -> bool {
        if !self.c.files().options.strict_null_checks {
            return false;
        }
        let parameter = self.c.hir(file)[p];
        let is_optional = self.is_optional_parameter(file, p);
        let is_property = parameter.flags.contains(Flags::PARAMETER_PROPERTY);
        // `isRequiredInitializedParameter`, `isOptionalUninitializedParameterProperty`
        let may_be_undefined = if parameter.default.is_some() {
            !is_optional && (!is_property || self.c.is_function_like_declaration(at))
        } else {
            is_optional && is_property
        };
        if !may_be_undefined {
            return false;
        }
        // `declaredParameterTypeContainsUndefined`
        if parameter.ty.is_none() {
            return true;
        }
        let declared = self.c.type_from_node(file, parameter.ty);
        self.c.is_known(declared)
            && !self.c.is_error_type(declared)
            && !self.c.contains_undefined(declared)
    }

    /// `shouldPrintWithInitializer`: the literal type of a constant that is written with its value.
    fn literal_const_type(&mut self, node: Typed) -> Option<TypeId> {
        let hir = self.c.hir(self.file());
        let ty = match node {
            Typed::Variable(d) if hir[d].kind == VarKind::Const && hir[d].init.is_some() => {
                self.c.type_of_pat(self.file(), hir[d].pat)
            }
            Typed::Property(m)
                if hir[m].flags.contains(Flags::READONLY) && hir[m].init.is_some() =>
            {
                self.c.iso_type_of_member(self.file(), m)
            }
            _ => return None,
        };
        self.c.is_fresh_literal(ty).then_some(ty)
    }

    /// `ensureType`
    fn ensure_type(&mut self, node: Typed, ignores_private: bool) {
        let (hir, bound) = (self.c.hir(self.file()), self.c.bound(self.file()));
        let member_of = |f: FnId| match bound.fns[f.idx()].owner {
            FnOwner::Member(m) => Some(m),
            _ => None,
        };
        let modifiers = match node {
            Typed::Property(m) => hir[m].flags,
            Typed::Parameter(p) => hir[p].flags,
            Typed::Signature(f) => member_of(f).map_or(Flags::empty(), |m| hir[m].flags),
            _ => Flags::empty(),
        };
        // What is private has no type, but for the parameter of a private parameter property.
        if !ignores_private && modifiers.contains(Flags::PRIVATE) {
            return;
        }
        if let Some(literal) = self.literal_const_type(node) {
            // `CreateLiteralConstValue`: a member of an enum is named.
            if let TypeData::EnumLit { member, .. } | TypeData::Enum { symbol: member, .. } =
                *self.c.data(literal)
            {
                self.tracker
                    .track_symbol(self.c, member, Some(self.enclosing), SymFlags::VALUE);
            }
            return;
        }
        let annotation = match node {
            Typed::Variable(d) => hir[d].ty,
            Typed::Property(m) => hir[m].ty,
            Typed::Parameter(p) => hir[p].ty,
            Typed::Signature(f) => hir[f].ret,
            Typed::Element(_) | Typed::Export(..) => TypeNodeId::NONE,
        };
        if annotation.is_some()
            && !matches!(node, Typed::Parameter(p)
                if self.requires_adding_implicit_undefined(self.file(), p, self.enclosing))
        {
            return self.visit_type(annotation, false);
        }
        let saved = (
            self.tracker.error_name_node,
            self.tracker.get_symbol_accessibility_diagnostic,
        );
        let name = match node {
            Typed::Variable(d) => Some(self.tracker.range_of_pat(self.c, hir[d].pat)),
            Typed::Element(pat) => Some(self.tracker.range_of_pat(self.c, pat)),
            Typed::Property(m) => Some(self.tracker.name_range_of_member(self.c, m)),
            Typed::Parameter(p) => Some(self.tracker.range_of_pat(self.c, hir[p].pat)),
            Typed::Signature(f) => match member_of(f) {
                Some(m) => matches!(
                    hir[m].kind,
                    MemberKind::Method | MemberKind::Getter | MemberKind::Setter
                )
                .then(|| self.tracker.name_range_of_member(self.c, m)),
                None => hir[f].name.is_some().then(|| {
                    (
                        hir[f].name_pos,
                        self.c.end_of_name_at(self.file(), hir[f].name_pos),
                    )
                }),
            },
            Typed::Export(..) => None,
        };
        self.tracker.error_name_node = name.map(|(start, end)| NameNode {
            start,
            end,
            of_variable: matches!(node, Typed::Variable(_)),
        });
        if !self.suppresses_new_contexts {
            self.tracker.get_symbol_accessibility_diagnostic = match node {
                Typed::Variable(d) => Context::Variable(hir[d].pat),
                Typed::Element(pat) => Context::Variable(pat),
                Typed::Property(m) => Context::Property(m),
                Typed::Parameter(p) => self.context_of_parameter(p),
                Typed::Signature(f) => match (hir[f].kind, member_of(f)) {
                    (FnKind::Getter | FnKind::Setter, Some(m)) => Context::Accessor(m),
                    (FnKind::Constructor, _) => Context::None,
                    (FnKind::Expr | FnKind::Arrow, _) => {
                        self.tracker.get_symbol_accessibility_diagnostic
                    }
                    _ => Context::Return(f),
                },
                Typed::Export(..) => self.tracker.get_symbol_accessibility_diagnostic,
            };
        }
        let flags = if self.in_class_expression {
            DECLARATION_EMIT_NODE_BUILDER_FLAGS & !WRITE_CLASS_EXPRESSION_AS_TYPE_LITERAL
        } else {
            DECLARATION_EMIT_NODE_BUILDER_FLAGS
        };
        let file = self.file();
        match node {
            // `CreateReturnTypeOfSignatureDeclaration`
            Typed::Signature(f) => {
                self.c.serialize_return_type_for_signature(
                    file,
                    f,
                    self.enclosing,
                    flags,
                    &mut self.tracker,
                );
            }
            Typed::Variable(d) => {
                let ty = self.c.type_of_pat(file, hir[d].pat);
                self.create_type_of_declaration(Some(SyntaxNode::Var(d)), ty, flags);
            }
            Typed::Element(pat) => {
                let ty = self.c.type_of_pat(file, pat);
                self.create_type_of_declaration(None, ty, flags);
            }
            Typed::Property(m) => {
                let ty = self.c.iso_type_of_member(file, m);
                self.create_type_of_declaration(Some(SyntaxNode::Member(m)), ty, flags);
            }
            Typed::Parameter(p) => {
                let ty = self.c.type_of_param(file, p);
                self.create_type_of_declaration(Some(SyntaxNode::Param(p)), ty, flags);
            }
            Typed::Export(s, e) => {
                let ty = self.type_of_export_assignment(s, e);
                self.create_type_of_declaration(Some(SyntaxNode::Stmt(s)), ty, flags);
            }
        }
        self.tracker.error_name_node = saved.0;
        if !self.suppresses_new_contexts {
            self.tracker.get_symbol_accessibility_diagnostic = saved.1;
        }
    }

    /// `getTypeOfSymbol`, of the symbol of `export default e` or `export = e`.
    fn type_of_export_assignment(&mut self, s: StmtId, e: ExprId) -> TypeId {
        let files = self.c.files();
        let (hir, bound) = (self.c.hir(self.file()), self.c.bound(self.file()));
        let container = match bound.stmt_parent[s.idx()] {
            Parent::Module(m) => files.sym(self.file(), bound.module_symbol[m.idx()]),
            _ => files.file_symbol(self.file()),
        };
        let name = if matches!(hir[s].kind, StmtKind::ExportDefault(_)) {
            known::default
        } else {
            known::export_equals
        };
        if let Some(symbol) = files.export(container, name)
            && files
                .decls_of(symbol)
                .iter()
                .any(|&d| d == (self.file(), Decl::ExportExpr(s)))
            && files.flags(symbol).contains(SymFlags::PROPERTY)
        {
            return self.c.type_of_symbol(symbol);
        }
        let ty = self.c.type_of_expr(self.file(), e);
        self.c.widened(ty)
    }

    /// `CreateTypeOfDeclaration`, of a declaration of this file whose symbol has the type `ty`.
    fn create_type_of_declaration(
        &mut self,
        declaration: Option<SyntaxNode>,
        ty: TypeId,
        flags: u32,
    ) {
        let file = self.file();
        self.c.serialize_type_for_declaration(
            file,
            declaration,
            ty,
            self.enclosing,
            flags,
            &mut self.tracker,
        );
    }

    /// `CreateTypeOfExpression`, of what the class around extends.
    fn create_type_of_expression(&mut self, e: ExprId) {
        let file = self.file();
        self.c.serialize_type_for_expression(
            file,
            e,
            self.enclosing,
            DECLARATION_EMIT_NODE_BUILDER_FLAGS,
            &mut self.tracker,
        );
    }
}

// ───────────────────────────── what a module is called (`modulespecifiers`) ─────────────────────────────

/// `ModuleSpecifierEnding`
#[derive(Copy, Clone, PartialEq, Eq)]
enum Ending {
    Minimal,
    Index,
    Js,
    Ts,
}

/// `MatchingMode`
#[derive(Copy, Clone, PartialEq, Eq)]
enum Matching {
    Exact,
    Directory,
    Pattern,
}

/// `tspath.PathIsRelative`
fn path_is_relative(path: &str) -> bool {
    path == "." || path == ".." || path.starts_with("./") || path.starts_with("../")
}

/// `RemoveFileExtension`
fn remove_file_extension(path: &str) -> &str {
    &path[..path.len() - known_extension(path).len()]
}

/// `TryGetRealFileNameForNonJSDeclarationFileName`
fn try_get_real_file_name_for_non_js_declaration_file_name(file_name: &str) -> Option<String> {
    let base_name = file_name.rsplit('/').next().unwrap_or(file_name);
    let no_extension = file_name.strip_suffix(".ts")?;
    if !base_name.contains(".d.") || base_name.ends_with(".d.ts") {
        return None;
    }
    let extension = &no_extension[no_extension.rfind('.')?..];
    let (before, _) = no_extension.split_once(".d.")?;
    Some([before, extension].concat())
}

/// `TryGetJSExtensionForFile`
fn js_extension_for_file(path: &str, preserves_jsx: bool) -> &'static str {
    match known_extension(path) {
        ".ts" | ".d.ts" | ".js" => ".js",
        ".tsx" if preserves_jsx => ".jsx",
        ".tsx" => ".js",
        ".jsx" => ".jsx",
        ".json" => ".json",
        ".d.mts" | ".mts" | ".mjs" => ".mjs",
        ".d.cts" | ".cts" | ".cjs" => ".cjs",
        _ => "",
    }
}

/// `GetRelativePathFromDirectory`
fn relative_path_from_directory(from: &str, to: &str) -> String {
    let from: Vec<&str> = from.split('/').filter(|part| !part.is_empty()).collect();
    let to: Vec<&str> = to.split('/').filter(|part| !part.is_empty()).collect();
    let mut common = 0;
    while common < from.len() && common < to.len() && from[common] == to[common] {
        common += 1;
    }
    let mut parts: Vec<&str> = vec![".."; from.len() - common];
    parts.extend_from_slice(&to[common..]);
    parts.join("/")
}

/// `GetNormalizedAbsolutePath(path, "")`, of the name of a package and what is in it.
fn normalized_name(path: &str) -> String {
    let mut parts: Vec<&str> = Vec::new();
    for part in path.split('/') {
        match part {
            "" | "." => {}
            ".." => {
                parts.pop();
            }
            part => parts.push(part),
        }
    }
    parts.join("/")
}

/// `GetPackageNameFromTypesPackageName`
fn package_name_from_types_package_name(name: &str) -> String {
    match name.strip_prefix("@types/") {
        Some(mangled) => match mangled.split_once("__") {
            Some((scope, rest)) => format!("@{scope}/{rest}"),
            None => mangled.to_owned(),
        },
        None => name.to_owned(),
    }
}

/// `tryGetModuleNameFromExportsOrImports`, of `exports`: what the file `target` is called by whoever imports it from the package
/// in `package_directory`. `swapped`: `target` with the extension it has once it is JavaScript. Empty: it cannot be imported.
fn module_name_from_exports(
    target: &str,
    swapped: &str,
    package_directory: &str,
    package_name: &str,
    exports: &Json,
    conditions: &[&str],
    matching: Matching,
) -> String {
    match exports {
        Json::String(value) => {
            let pattern = join(package_directory, value);
            for candidate in [swapped, target] {
                if candidate.is_empty() {
                    continue;
                }
                match matching {
                    Matching::Exact => {
                        if candidate == pattern {
                            return package_name.to_owned();
                        }
                    }
                    Matching::Directory => {
                        if candidate
                            .strip_prefix(pattern.as_str())
                            .is_some_and(|rest| rest.starts_with('/'))
                        {
                            let fragment = relative_path_from_directory(&pattern, candidate);
                            return normalized_name(
                                &[package_name, "/", value.as_str(), "/", fragment.as_str()]
                                    .concat(),
                            );
                        }
                    }
                    Matching::Pattern => {
                        let (leading, trailing) =
                            pattern.split_once('*').unwrap_or((pattern.as_str(), ""));
                        if leading.len() + trailing.len() <= candidate.len()
                            && candidate.starts_with(leading)
                            && candidate.ends_with(trailing)
                        {
                            let star = &candidate[leading.len()..candidate.len() - trailing.len()];
                            return package_name.replacen('*', star, 1);
                        }
                    }
                }
            }
        }
        Json::Array(list) => {
            for entry in list {
                let name = module_name_from_exports(
                    target,
                    swapped,
                    package_directory,
                    package_name,
                    entry,
                    conditions,
                    matching,
                );
                if !name.is_empty() {
                    return name;
                }
            }
        }
        // A condition each.
        Json::Object(entries) => {
            for (key, value) in entries {
                if key != "default"
                    && !conditions.contains(&key.as_str())
                    && !(key.starts_with("types@") && conditions.contains(&"types"))
                {
                    continue;
                }
                let name = module_name_from_exports(
                    target,
                    swapped,
                    package_directory,
                    package_name,
                    value,
                    conditions,
                    matching,
                );
                if !name.is_empty() {
                    return name;
                }
            }
        }
        _ => {}
    }
    String::new()
}

/// `tryGetModuleNameFromExports`
fn module_name_from_package_exports(
    target: &str,
    swapped: &str,
    package_directory: &str,
    package_name: &str,
    exports: &Json,
    conditions: &[&str],
) -> String {
    // `IsSubpaths`
    if let Json::Object(entries) = exports
        && !entries.is_empty()
        && entries.iter().all(|entry| entry.0.starts_with('.'))
    {
        for (key, value) in entries {
            let matching = if key.ends_with('/') {
                Matching::Directory
            } else if key.contains('*') {
                Matching::Pattern
            } else {
                Matching::Exact
            };
            let name = module_name_from_exports(
                target,
                swapped,
                package_directory,
                &normalized_name(&[package_name, "/", key.as_str()].concat()),
                value,
                conditions,
                matching,
            );
            if !name.is_empty() {
                return name;
            }
        }
    }
    module_name_from_exports(
        target,
        swapped,
        package_directory,
        package_name,
        exports,
        conditions,
        Matching::Exact,
    )
}

impl<'p> EmitResolver<'_, 'p> {
    /// The relative specifiers `file` mentions, in the order it does.
    fn relative_specifiers_of(&self, file: FileId) -> Vec<&'p str> {
        let files = self.c.files();
        self.c
            .bound(file)
            .specifiers
            .iter()
            .filter_map(|&specifier| std::str::from_utf8(files.atoms.bytes(specifier)).ok())
            .filter(|text| path_is_relative(text))
            .collect()
    }

    /// `GetDefaultResolutionModeForFile`
    fn default_resolution_mode_for_file(&self, file: FileId) -> ResolutionMode {
        let files = self.c.files();
        let options = &files.options;
        // `importSyntaxAffectsModuleResolution`
        if options.resolves_like_node
            || options.resolve_package_json_exports
            || options.resolve_package_json_imports
        {
            files.module(file).implied_format
        } else {
            ResolutionMode::None
        }
    }

    /// `resolutionMode` in `getSpecifierForModuleSymbol`. `mode`: `overrideImportMode`.
    fn resolution_mode_for_specifier(
        &self,
        importing: FileId,
        mode: ResolutionMode,
    ) -> ResolutionMode {
        if mode != ResolutionMode::None {
            return mode;
        }
        match self.c.enclosing_module_specifier_mode {
            Some(mode) => mode,
            None => self.default_resolution_mode_for_file(importing),
        }
    }

    /// `getPreferredEnding`. `prefers_js`: `ImportModuleSpecifierEndingPreferenceJs`.
    fn preferred_ending(
        &self,
        importing: FileId,
        prefers_js: bool,
        mode: ResolutionMode,
    ) -> Ending {
        let files = self.c.files();
        let mode = if mode == ResolutionMode::None {
            self.default_resolution_mode_for_file(importing)
        } else {
            mode
        };
        let is_node = files.options.resolves_like_node;
        // `ExtensionsNotSupportingExtensionlessResolution` say nothing of what is preferred.
        let is_telling = |text: &&str| {
            !matches!(
                known_extension(text),
                ".mts" | ".d.mts" | ".mjs" | ".cts" | ".d.cts" | ".cjs"
            )
        };
        let has_ts_extension =
            |text: &str| matches!(known_extension(text), ".ts" | ".tsx" | ".d.ts");
        let has_js_extension = |text: &str| matches!(known_extension(text), ".js" | ".jsx");
        let specifiers = self.relative_specifiers_of(importing);
        // `inferPreference`
        let inferred = || {
            if is_node && mode == ResolutionMode::Require {
                return Ending::Minimal;
            }
            let mut telling = specifiers.iter().copied().filter(is_telling);
            if telling.clone().any(|text| has_ts_extension(text)) {
                Ending::Ts
            } else if telling.any(|text| has_js_extension(text)) {
                Ending::Js
            } else {
                Ending::Minimal
            }
        };
        let allows_ts = files.options.allow_importing_ts_extensions;
        if prefers_js || mode == ResolutionMode::Import && is_node {
            return if allows_ts && inferred() != Ending::Js {
                Ending::Ts
            } else {
                Ending::Js
            };
        }
        if allows_ts {
            return inferred();
        }
        // `usesExtensionsOnImports`
        match specifiers.iter().copied().find(is_telling) {
            Some(first) if has_ts_extension(first) || has_js_extension(first) => Ending::Js,
            _ => Ending::Minimal,
        }
    }

    /// `GetAllowedEndingsInPreferredOrder`
    fn allowed_endings(
        &self,
        importing: FileId,
        prefers_js: bool,
        mode: ResolutionMode,
    ) -> Vec<Ending> {
        let files = self.c.files();
        let allows_ts = files.options.allow_importing_ts_extensions
            || is_declaration_file_name(&files.module(importing).path);
        if mode == ResolutionMode::Import && files.options.resolves_like_node {
            return if allows_ts {
                vec![Ending::Ts, Ending::Js]
            } else {
                vec![Ending::Js]
            };
        }
        match (
            self.preferred_ending(importing, prefers_js, mode),
            allows_ts,
        ) {
            (Ending::Js, true) => vec![Ending::Js, Ending::Ts, Ending::Minimal, Ending::Index],
            (Ending::Js, false) => vec![Ending::Js, Ending::Minimal, Ending::Index],
            (Ending::Ts, _) => vec![Ending::Ts, Ending::Minimal, Ending::Js, Ending::Index],
            (Ending::Index, true) => vec![Ending::Index, Ending::Minimal, Ending::Ts, Ending::Js],
            (Ending::Index, false) => vec![Ending::Index, Ending::Minimal, Ending::Js],
            (Ending::Minimal, true) => vec![Ending::Minimal, Ending::Index, Ending::Ts, Ending::Js],
            (Ending::Minimal, false) => vec![Ending::Minimal, Ending::Index, Ending::Js],
        }
    }

    /// `processEnding`
    fn process_ending(&self, file_name: &str, allowed: &[Ending]) -> String {
        let files = self.c.files();
        let extension = known_extension(file_name);
        if matches!(extension, "" | ".json" | ".mjs" | ".cjs") {
            return file_name.to_owned();
        }
        let no_extension = remove_file_extension(file_name);
        let with_js_extension = || {
            let preserves_jsx = files.options.jsx == JsxEmit::Preserve;
            [
                no_extension,
                js_extension_for_file(file_name, preserves_jsx),
            ]
            .concat()
        };
        let priority = |ending: Ending| allowed.iter().position(|&allowed| allowed == ending);
        let js_priority = priority(Ending::Js);
        if matches!(extension, ".mts" | ".cts")
            && priority(Ending::Ts).is_some_and(|ts| js_priority.is_some_and(|js| ts < js))
        {
            return file_name.to_owned();
        }
        if matches!(extension, ".d.mts" | ".d.cts" | ".mts" | ".cts") {
            return with_js_extension();
        }
        if extension == ".ts"
            && file_name.contains(".d.")
            && let Some(real) = try_get_real_file_name_for_non_js_declaration_file_name(file_name)
        {
            return real;
        }
        match allowed.first() {
            Some(Ending::Minimal) | None => match no_extension.strip_suffix("/index") {
                // `index` stays if there is a file of the name of the directory. Of the files there are, those of the program are known.
                Some(directory)
                    if ![
                        ".ts", ".tsx", ".d.ts", ".js", ".jsx", ".cts", ".d.cts", ".cjs", ".mts",
                        ".d.mts", ".mjs", ".json",
                    ]
                    .iter()
                    .any(|extension| {
                        files
                            .by_path
                            .contains_key(&[directory, *extension].concat())
                    }) =>
                {
                    directory.to_owned()
                }
                _ => no_extension.to_owned(),
            },
            Some(Ending::Index) => no_extension.to_owned(),
            Some(Ending::Js) => with_js_extension(),
            Some(Ending::Ts) => {
                if !is_declaration_file_name(file_name) {
                    return file_name.to_owned();
                }
                let extensionless = allowed
                    .iter()
                    .position(|ending| matches!(ending, Ending::Minimal | Ending::Index));
                if extensionless.is_some_and(|at| js_priority.is_some_and(|js| at < js)) {
                    no_extension.to_owned()
                } else {
                    with_js_extension()
                }
            }
        }
    }

    /// `tryGetModuleNameAsNodeModule`: what the file at `path`, which is in `node_modules`, is called by `importing`. Empty: it cannot
    /// be named through `node_modules`.
    fn module_name_as_node_module(
        &self,
        path: &str,
        importing: FileId,
        mode: ResolutionMode,
        prefers_js: bool,
    ) -> String {
        let files = self.c.files();
        let options = &files.options;
        let Some((top_level_node_modules, top_level_package_name, package_root)) =
            node_module_path_parts(path)
        else {
            return String::new();
        };
        let package_directory = &path[..package_root];
        // `tryDirectoryWithPackageJson`
        let is_package_root = match files.package_jsons.get(package_directory) {
            // An `index` is found by the name of the package all the same.
            None => matches!(
                path.get(package_root + 1..),
                Some("index.d.ts" | "index.js" | "index.ts" | "index.tsx")
            ),
            Some(json) => {
                if options.resolve_package_json_exports
                    && let Some(exports) = json.get("exports")
                {
                    let mode = match known_extension(path) {
                        ".cjs" | ".cts" | ".d.cts" => ResolutionMode::Require,
                        ".mjs" | ".mts" | ".d.mts" => ResolutionMode::Import,
                        _ if mode == ResolutionMode::None => {
                            self.default_resolution_mode_for_file(importing)
                        }
                        _ => mode,
                    };
                    // `GetConditions`
                    let is_import = mode == ResolutionMode::Import
                        || mode == ResolutionMode::None && !options.resolves_like_node;
                    let mut conditions =
                        vec![if is_import { "import" } else { "require" }, "types"];
                    if options.resolves_like_node {
                        conditions.push("node");
                    }
                    conditions.extend(options.custom_conditions.iter().map(String::as_str));
                    let swapped = if matches!(
                        known_extension(path),
                        ".ts" | ".tsx" | ".d.ts" | ".cts" | ".d.cts" | ".mts" | ".d.mts"
                    ) {
                        let preserves_jsx = options.jsx == JsxEmit::Preserve;
                        [
                            remove_file_extension(path),
                            js_extension_for_file(path, preserves_jsx),
                        ]
                        .concat()
                    } else {
                        String::new()
                    };
                    // What `exports` does not lead to cannot be named through `node_modules`.
                    return module_name_from_package_exports(
                        path,
                        &swapped,
                        package_directory,
                        &package_name_from_types_package_name(
                            &package_directory[top_level_package_name + 1..],
                        ),
                        exports,
                        &conditions,
                    );
                }
                // The main file goes by the name of the package.
                let main = ["typings", "types", "main"]
                    .iter()
                    .find_map(|field| json.get(field).and_then(Json::as_str))
                    .unwrap_or("index.js");
                let main = join(package_directory, main);
                remove_file_extension(&main) == remove_file_extension(path)
                    || json.get("type").and_then(Json::as_str) != Some("module")
                        && !matches!(
                            known_extension(path),
                            ".mts" | ".d.mts" | ".mjs" | ".cts" | ".d.cts" | ".cjs"
                        )
                        && parent_dir(path) == main
                        && remove_file_extension(&path[main.len()..]) == "/index"
            }
        };
        let module_specifier = if is_package_root {
            package_directory.to_owned()
        } else {
            let allowed = self.allowed_endings(importing, prefers_js, ResolutionMode::None);
            self.process_ending(path, &allowed)
        };
        if !parent_dir(&files.module(importing).path).starts_with(&path[..top_level_node_modules]) {
            return String::new();
        }
        package_name_from_types_package_name(&module_specifier[top_level_package_name + 1..])
    }

    /// `GetEachFileNameOfModule`: the paths that lead to the file at `real` by a link to a directory it is in.
    fn paths_through_links(&self, real: &str, importing: &str) -> Vec<String> {
        let links = &self.c.files().linked_directories;
        let mut paths = Vec::new();
        let mut directory = parent_dir(real);
        while !links.is_empty() && !directory.is_empty() && directory != "/" {
            let mut to_here = links.iter().filter(|link| link.0 == directory).peekable();
            if to_here.peek().is_some() {
                // A package does not import from itself by its name.
                if importing
                    .strip_prefix(directory)
                    .is_some_and(|rest| rest.starts_with('/'))
                {
                    break;
                }
                for link in to_here {
                    paths.push([link.1.as_str(), &real[directory.len()..]].concat());
                }
            }
            directory = parent_dir(directory);
        }
        paths
    }

    /// `getAllModulePathsWorker`, `computeModuleSpecifiers`, the first of them: what `importing` calls a file that all of `paths` lead to.
    fn module_specifier_among(
        &self,
        mut paths: Vec<String>,
        importing: FileId,
        mode: ResolutionMode,
        target_mode: ResolutionMode,
    ) -> String {
        let from = parent_dir(&self.c.files().module(importing).path);
        // How far up from the importing file the directory is that `path` is in.
        let distance = |path: &str| {
            let (mut directory, mut up) = (from, 0);
            while !directory.is_empty()
                && directory != "/"
                && !path
                    .strip_prefix(directory)
                    .is_some_and(|rest| rest.starts_with('/'))
            {
                directory = parent_dir(directory);
                up += 1;
            }
            up
        };
        paths.sort_by(|a, b| {
            distance(a)
                .cmp(&distance(b))
                .then(a.matches('/').count().cmp(&b.matches('/').count()))
                .then(a.cmp(b))
        });
        paths.dedup();
        let prefers_js =
            self.resolution_mode_for_specifier(importing, mode) == ResolutionMode::Import;
        let is_in_node_modules = paths.iter().any(|path| path.contains("/node_modules/"));
        let mut relative_specifier = None;
        for path in &paths {
            let is_through_node_modules = path.contains("/node_modules/");
            if is_through_node_modules {
                let name = self.module_name_as_node_module(path, importing, mode, prefers_js);
                if !name.is_empty() {
                    return name;
                }
            }
            // A relative path to another package is not portable: the one through `node_modules` is taken, which is reported.
            if relative_specifier.is_none() && (is_through_node_modules || !is_in_node_modules) {
                let relative = relative_path_from_directory(from, path);
                let relative = if path_is_relative(&relative) {
                    relative
                } else {
                    format!("./{relative}")
                };
                relative_specifier = Some(self.process_ending(
                    &relative,
                    &self.allowed_endings(importing, prefers_js, target_mode),
                ));
            }
        }
        relative_specifier.unwrap_or_default()
    }

    /// `GetModuleSpecifiers`, the first of them: what `importing` calls the file `target`. Empty: it is not worked out, which `paths`,
    /// `rootDirs` and links in the file system would have a say in.
    fn module_specifier(&self, target: FileId, importing: FileId, mode: ResolutionMode) -> String {
        let files = self.c.files();
        let from = files.module(importing);
        let target_mode = if mode == ResolutionMode::None {
            self.default_resolution_mode_for_file(importing)
        } else {
            mode
        };
        // What the file is imported by already.
        'existing: for &specifier in &self.c.bound(importing).specifiers {
            for used in [
                from.default_mode,
                ResolutionMode::Import,
                ResolutionMode::Require,
                ResolutionMode::None,
            ] {
                if from.imports.get(&(specifier, used)) != Some(&target) {
                    continue;
                }
                if used == target_mode
                    || used == ResolutionMode::None
                    || target_mode == ResolutionMode::None
                {
                    return self.c.atom_text(specifier);
                }
                break 'existing;
            }
        }
        if !files.options.paths.is_empty() || !files.options.root_dirs.is_empty() {
            return String::new();
        }
        let prefers_js =
            self.resolution_mode_for_specifier(importing, mode) == ResolutionMode::Import;
        let path = files.module(target).path.as_str();
        let mut paths = self.paths_through_links(path, &from.path);
        if !paths.is_empty() {
            // `containsIgnoredPath`
            if !["/node_modules/.", "/.git", ".#"]
                .iter()
                .any(|ignored| path.contains(ignored))
            {
                paths.push(path.to_owned());
            }
            return self.module_specifier_among(paths, importing, mode, target_mode);
        }
        if path.contains("/node_modules/") {
            let name = self.module_name_as_node_module(path, importing, mode, prefers_js);
            if !name.is_empty() {
                return name;
            }
        }
        // `getLocalModuleSpecifier`
        let relative = relative_path_from_directory(parent_dir(&from.path), path);
        let relative = if path_is_relative(&relative) {
            relative
        } else {
            format!("./{relative}")
        };
        self.process_ending(
            &relative,
            &self.allowed_endings(importing, prefers_js, target_mode),
        )
    }

    /// `getSpecifierForModuleSymbol`
    fn specifier_for_module_symbol(
        &mut self,
        symbol: Sym,
        importing: FileId,
        mode: ResolutionMode,
    ) -> String {
        let resolution_mode = self.resolution_mode_for_specifier(importing, mode);
        if let Some(known) = self
            .links
            .specifiers
            .get(&(symbol, importing, resolution_mode))
        {
            return known.clone();
        }
        let decls = self.c.decls_of(symbol);
        // `isAmbientModuleSymbolName(symbol.Name)`
        let ambient_name = match decls.first() {
            Some(&(file, Decl::Module(m))) => match self.c.hir(file)[m].name {
                ModuleName::String(name) => Some(name),
                _ => None,
            },
            _ => None,
        };
        let mut target = None;
        let mut specifier = None;
        for (file, decl) in decls {
            match decl {
                Decl::File => target = target.or(Some(file)),
                // `tryGetModuleNameFromAmbientModule`
                Decl::Module(m) => {
                    if let ModuleName::String(name) = self.c.hir(file)[m].name {
                        let name = self.c.atom_text(name);
                        if !self.c.hir(file).has_module_syntax || !is_relative(&name) {
                            specifier = specifier.or(Some(name));
                        }
                    }
                }
                _ => {}
            }
        }
        let specifier = match (ambient_name, specifier, target) {
            // Without a file, `StripQuotes(symbol.Name)`.
            (Some(name), _, None) => self.c.atom_text(name),
            (_, Some(name), _) => name,
            (_, None, target) => match target.or_else(|| self.c.source_file_of_module(symbol)) {
                Some(target) => self.module_specifier(target, importing, mode),
                None => String::new(),
            },
        };
        self.links
            .specifiers
            .insert((symbol, importing, resolution_mode), specifier.clone());
        specifier
    }

    /// `sortByBestName`
    fn sort_by_best_name(&self, a: &(Sym, String), b: &(Sym, String)) -> std::cmp::Ordering {
        if a.1.is_empty() || b.1.is_empty() {
            return self.c.compare_symbols_of_chain(a.0, b.0);
        }
        // `CountPathComponents`
        let components = |path: &str| path.strip_prefix("./").unwrap_or(path).matches('/').count();
        match (path_is_relative(&a.1), path_is_relative(&b.1)) {
            (false, true) => std::cmp::Ordering::Less,
            (true, false) => std::cmp::Ordering::Greater,
            _ => components(&a.1).cmp(&components(&b.1)),
        }
    }

    /// `getSymbolChain`, which may start with a module (`yieldModuleSymbol`).
    fn symbol_chain(
        &mut self,
        symbol: Sym,
        at: Enclosing,
        meaning: Meaning,
        depth: u32,
    ) -> Vec<Sym> {
        self.symbol_chain_ex(symbol, at, meaning, true, depth)
    }

    /// `getSymbolChain`. `endOfChain`: `depth` is 0.
    fn symbol_chain_ex(
        &mut self,
        symbol: Sym,
        at: Enclosing,
        meaning: Meaning,
        yields_module: bool,
        depth: u32,
    ) -> Vec<Sym> {
        let mut chain = self.accessible_symbol_chain(symbol, at, meaning).to_vec();
        let qualifier_meaning = if chain.len() > 1 {
            meaning.left()
        } else {
            meaning
        };
        let root = chain.first().copied();
        if depth < 32
            && root.is_none_or(|root| self.needs_qualification(root, at, qualifier_meaning))
        {
            // Go up and add the parent.
            let mut parents: Vec<(Sym, String)> = Vec::new();
            for parent in self.containers_of_symbol(root.unwrap_or(symbol), at, meaning) {
                let name = if self.c.is_external_module_symbol(parent) {
                    self.specifier_for_module_symbol(parent, at.file, ResolutionMode::None)
                } else {
                    String::new()
                };
                parents.push((parent, name));
            }
            parents.sort_by(|a, b| self.sort_by_best_name(a, b));
            for (parent, _) in parents {
                let mut parent_chain =
                    self.symbol_chain_ex(parent, at, meaning.left(), yields_module, depth + 1);
                if parent_chain.is_empty() {
                    continue;
                }
                // The module says with `export =` that it is the symbol.
                let is_the_module = self
                    .c
                    .files()
                    .export(parent, known::export_equals)
                    .is_some_and(|equals| self.c.is_same_reference(equals, symbol));
                if !is_the_module {
                    if chain.is_empty() {
                        let last = self
                            .alias_for_symbol_in_container(parent, symbol)
                            .unwrap_or(symbol);
                        chain.push(self.c.target_of_module_clone(last));
                    }
                    parent_chain.append(&mut chain);
                }
                chain = parent_chain;
                break;
            }
        }
        // A parent that is an external module is not written, unless the chain may start with it.
        if chain.is_empty()
            && (depth == 0 || yields_module || !self.c.is_external_module_symbol(symbol))
        {
            // What `cloneTypeAsModuleType` made is written as its target: it has the name and the declarations of that.
            chain.push(self.c.target_of_module_clone(symbol));
        }
        chain
    }

    /// The part of `symbolToTypeNode` that writes `import("specifier")` for `module`: the specifier, and the `resolution-mode` attribute.
    fn import_type_specifier_and_mode(
        &mut self,
        module: Sym,
        importing: FileId,
        allows_node_modules_relative_paths: bool,
    ) -> (String, Option<&'static str>) {
        let files = self.c.files();
        let is_node = files.options.resolves_like_node;
        // `GetEmitModuleFormatOfFile`
        let context_format = files.module(importing).implied_format;
        let target_format = self
            .c
            .decls_of(module)
            .into_iter()
            .find(|d| d.1 == Decl::File)
            .map(|d| d.0)
            .or_else(|| self.c.source_file_of_module(module))
            .map(|file| files.module(file).implied_format);
        let mut specifier = String::new();
        let mut mode = None;
        // An `import` type that leads to an ECMAScript module only resolves as `import` does.
        if is_node
            && target_format == Some(ResolutionMode::Import)
            && context_format != ResolutionMode::Import
        {
            specifier = self.specifier_for_module_symbol(module, importing, ResolutionMode::Import);
            mode = Some("import");
        }
        if specifier.is_empty() {
            specifier = self.specifier_for_module_symbol(module, importing, ResolutionMode::None);
        }
        if !allows_node_modules_relative_paths && is_node && specifier.contains("/node_modules/") {
            // Resolved the other way it may be found.
            let (swapped, swapped_mode) = if context_format == ResolutionMode::Import {
                (ResolutionMode::Require, "require")
            } else {
                (ResolutionMode::Import, "import")
            };
            let other = self.specifier_for_module_symbol(module, importing, swapped);
            if !other.contains("/node_modules/") {
                return (other, Some(swapped_mode));
            }
        }
        (specifier, mode)
    }
}
