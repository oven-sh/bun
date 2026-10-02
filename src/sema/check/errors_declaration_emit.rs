//! What stands in the way of a declaration file: `Program.GetDeclarationDiagnostics`.
//!
//! tsgo runs the declaration transformer (`transformers/declarations`) over a file and keeps what it reports. The transformer goes
//! through what the file exports. A type that is written is gone through for the names in it, a type that is not is made into
//! syntax by the node builder (`checker/nodebuilderimpl.go`, `nodecopy.go`), which tells the transformer's `SymbolTracker` of each
//! symbol it names and of what it cannot write. Nothing is written here: the same way is gone, and the same is asked
//! (`checker/symbolaccessibility.go`, `checker/emitresolver.go`).

use super::errors::Diagnostic;
use super::explain::Related;
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

/// `globalThisSymbol`, which no file declares.
const GLOBAL_THIS: Sym = Sym {
    file: FileId(u32::MAX),
    id: SymbolId(u32::MAX),
};

/// Set in the id of the alias an `import * as ns` declares: the symbol `cloneTypeAsModuleType` makes for that import, which no file
/// declares either.
const MODULE_CLONE: u32 = 1 << 31;

/// What `resolveESModuleSymbol` gives for `originating_import`, the alias of an `import * as ns` that is not the module as it stands.
fn module_clone(originating_import: Sym) -> Sym {
    Sym {
        file: originating_import.file,
        id: SymbolId(originating_import.id.0 | MODULE_CLONE),
    }
}

/// `nodebuilder.Flags`, those that are not the same all the way through a file.
const WRITE_CLASS_EXPRESSION_AS_TYPE_LITERAL: u32 = 1 << 0;
const IN_OBJECT_TYPE_LITERAL: u32 = 1 << 1;
const ALLOW_UNIQUE_ES_SYMBOL_TYPE: u32 = 1 << 2;

/// `noTruncationMaximumTruncationLength`
const MAXIMUM_LENGTH: usize = 1_000_000;
/// Deeper than this nothing is looked at.
const MAXIMUM_DEPTH: u32 = 150;

/// What a name is wanted as.
#[derive(Copy, Clone, PartialEq, Eq, Hash)]
enum Meaning {
    /// `SymbolFlagsNone`
    None,
    Value,
    /// `SymbolFlagsValue | SymbolFlagsExportValue`, which `getQualifiedLeftMeaning` does not take for `SymbolFlagsValue`.
    ValueOfName,
    Type,
    Namespace,
}

impl Meaning {
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

/// `enclosingDeclaration`: the scope names are looked up from. `variable`: it is that variable declaration.
#[derive(Copy, Clone, PartialEq, Eq, Hash)]
struct Enclosing {
    file: FileId,
    scope: ScopeId,
    variable: VarDeclId,
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
struct Access {
    accessibility: Accessibility,
    /// `AliasesToMakeVisible`
    aliases: Vec<(FileId, StmtId)>,
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

    fn is_accessible(&self) -> bool {
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

/// The declaration `serializeTypeForDeclaration` goes by.
#[derive(Copy, Clone)]
enum Declared {
    None,
    Variable(FileId, VarDeclId),
    Member(FileId, MemberId),
    Parameter(FileId, ParamId),
    /// A property of an object literal.
    Literal(FileId, PropId),
    Export(FileId, ExprId),
}

/// `CompositeSymbolIdentity`
#[derive(Copy, Clone, PartialEq, Eq)]
enum Identity {
    Origin(Origin),
    Instance(Sym),
    Function(FileId, FnId),
    Conditional(FileId, TypeNodeId),
}

/// An error.
struct Found {
    start: u32,
    end: u32,
    code: u32,
    args: Vec<String>,
    related: Vec<Related>,
}

/// `TrackedSymbolArgs`
#[derive(Copy, Clone)]
struct Tracked {
    symbol: Sym,
    at: Enclosing,
    meaning: Meaning,
    /// It is the local symbol of what a module or a namespace exports (`ExportSymbol`), which nothing outside can name.
    as_local: bool,
}

/// What the `SymbolTracker` is told of besides symbols.
#[derive(Clone)]
enum Report {
    CyclicStructure,
    InaccessibleThis,
    InaccessibleUniqueSymbol,
    /// The specifier, and the name of the symbol.
    LikelyUnsafeImportRequired(String, String),
    NonSerializableProperty(String),
    PrivateInBaseOfClassExpression(String),
}

/// `recoveryBoundary`
struct Boundary {
    had_error: bool,
    deferred: Vec<Report>,
    tracked: Vec<Tracked>,
    old_tracked: Vec<Tracked>,
    old_encountered_error: bool,
    old_length: usize,
}

/// `SerializedTypeEntry`
struct Serialized {
    truncating: bool,
    added_length: usize,
    tracked: Vec<Tracked>,
}

/// The links of a property of a reverse mapped type.
#[derive(Copy, Clone)]
struct ReverseMappedProperty {
    owner: TypeId,
    name: Atom,
    property_type: TypeId,
    mapped: Option<(FileId, TypeNodeId)>,
}

/// `NodeBuilderContext`
struct Builder {
    enclosing: Enclosing,
    flags: u32,
    approximate_length: usize,
    truncating: bool,
    encountered_error: bool,
    reported_diagnostic: bool,
    visited_types: Vec<TypeId>,
    symbol_depth: Vec<(Identity, u32)>,
    infer_type_parameters: Vec<TypeId>,
    /// `enclosingDeclaration` is a block `enterNewScope` made up for the parameters or the type parameters of a signature.
    is_in_made_up_scope: bool,
    reverse_mapped_stack: Vec<ReverseMappedProperty>,
    mapper: MapperId,
    depth: u32,
    /// How many of the types that are being written out may go by a name in TypeScript, which keeps `t.alias`: here the alias is found
    /// again from the syntax, and not always. What is named inside such a type may never be named there, so nothing is said of it.
    may_be_named: u32,
    tracked: Vec<Tracked>,
    boundaries: Vec<Boundary>,
    serialized: FxHashMap<(TypeId, u32, Enclosing), Serialized>,
}

impl Builder {
    fn new(enclosing: Enclosing, flags: u32) -> Builder {
        Builder {
            enclosing,
            flags,
            approximate_length: 0,
            truncating: false,
            encountered_error: false,
            reported_diagnostic: false,
            visited_types: Vec::new(),
            symbol_depth: Vec::new(),
            infer_type_parameters: Vec::new(),
            is_in_made_up_scope: false,
            reverse_mapped_stack: Vec::new(),
            mapper: MapperId::IDENTITY,
            depth: 0,
            may_be_named: 0,
            tracked: Vec::new(),
            boundaries: Vec::new(),
            serialized: FxHashMap::default(),
        }
    }
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

struct DeclarationEmit<'c, 'p> {
    c: &'c mut Checker<'p>,
    file: FileId,
    found: Vec<Found>,

    // `DeclarationTransformer`
    enclosing: Enclosing,
    context: Context,
    error_name: Option<NameNode>,
    fallback: Vec<FallbackNode>,
    suppresses_new_contexts: bool,
    in_class_expression: bool,
    late_marked: Vec<StmtId>,
    /// `lateStatementReplacementMap`: the statements something is written for.
    written: FxHashSet<StmtId>,
    interface_scopes: Vec<ScopeId>,
    module_scopes: Vec<ScopeId>,

    // `EmitResolver`
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

    b: Builder,
}

impl<'p> Checker<'p> {
    /// `getDeclarationDiagnosticsForFile`
    pub(super) fn check_declaration_emit(&mut self, file: FileId, out: &mut Vec<Diagnostic>) {
        let files = self.files();
        let module = files.module(file);
        // `sourceFileMayBeEmitted`. `stripInternal` goes by comments, which are not kept.
        if !matches!(module.hir.kind, FileKind::Ts | FileKind::Tsx)
            || files.options.strips_internal_declarations
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
            emit.found
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
        let top = Enclosing {
            file,
            scope: ScopeId(0),
            variable: VarDeclId::NONE,
        };
        DeclarationEmit {
            c,
            file,
            found: Vec::new(),
            enclosing: top,
            context: Context::None,
            error_name: None,
            fallback: Vec::new(),
            suppresses_new_contexts: false,
            in_class_expression: false,
            late_marked: Vec::new(),
            written: FxHashSet::default(),
            interface_scopes,
            module_scopes,
            visibility: FxHashMap::default(),
            statements: FxHashMap::default(),
            chains: FxHashMap::default(),
            containing_modules: FxHashMap::default(),
            exports: FxHashMap::default(),
            global_aliases: None,
            specifiers: FxHashMap::default(),
            b: Builder::new(top, 0),
        }
    }
}

/// What `getAccessibleSymbolChain`, `getAlternativeContainingModules`, `isDeclarationVisible` and `getSpecifierForModuleSymbol` memoize,
/// kept between the types that are printed from one enclosing file.
#[derive(Default)]
pub(super) struct SymbolChainCache {
    file: Option<FileId>,
    visibility: FxHashMap<(FileId, Decl), bool>,
    statements: FxHashMap<FileId, Rc<Statements>>,
    chains: FxHashMap<(Sym, FileId, ScopeId, Meaning), Rc<Vec<Sym>>>,
    containing_modules: FxHashMap<(Sym, FileId), Rc<Vec<Sym>>>,
    exports: FxHashMap<Sym, Rc<Vec<(Atom, Sym)>>>,
    global_aliases: Option<Rc<Vec<(Atom, Sym)>>>,
    specifiers: FxHashMap<(Sym, FileId, ResolutionMode), String>,
}

impl<'p> Checker<'p> {
    /// Asks something of `symbolaccessibility.go` with `scope` of `file` for `enclosingDeclaration`.
    fn with_enclosing_declaration<T>(
        &mut self,
        file: FileId,
        scope: ScopeId,
        ask: impl FnOnce(&mut DeclarationEmit<'_, 'p>) -> T,
    ) -> T {
        let mut cache = std::mem::take(&mut self.symbol_chain_cache);
        if cache.file != Some(file) {
            cache = SymbolChainCache::default();
        }
        let (result, cache) = {
            let mut emit = DeclarationEmit::new(self, file);
            emit.b.enclosing.scope = scope;
            emit.visibility = cache.visibility;
            emit.statements = cache.statements;
            emit.chains = cache.chains;
            emit.containing_modules = cache.containing_modules;
            emit.exports = cache.exports;
            emit.global_aliases = cache.global_aliases;
            emit.specifiers = cache.specifiers;
            let result = ask(&mut emit);
            let cache = SymbolChainCache {
                file: Some(file),
                visibility: emit.visibility,
                statements: emit.statements,
                chains: emit.chains,
                containing_modules: emit.containing_modules,
                exports: emit.exports,
                global_aliases: emit.global_aliases,
                specifiers: emit.specifiers,
            };
            (result, cache)
        };
        self.symbol_chain_cache = cache;
        result
    }

    /// `lookupSymbolChain` of a symbol that is no type parameter: whether the chain starts with `globalThis`, and the rest of it.
    pub(super) fn lookup_symbol_chain_at(
        &mut self,
        symbol: Sym,
        is_value: bool,
        yields_module: bool,
        file: FileId,
        scope: ScopeId,
    ) -> (bool, Vec<Sym>) {
        let meaning = if is_value {
            Meaning::Value
        } else {
            Meaning::Type
        };
        let mut chain = self.with_enclosing_declaration(file, scope, |emit| {
            emit.symbol_chain_ex(symbol, meaning, yields_module, 0)
        });
        let starts_with_global_this = chain.len() > 1 && chain[0] == GLOBAL_THIS;
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
        file: FileId,
        scope: ScopeId,
    ) -> (bool, Vec<Sym>) {
        let symbol = module_clone(originating_import);
        self.lookup_symbol_chain_at(symbol, true, yields_module, file, scope)
    }

    /// `IsTypeSymbolAccessible`
    pub(super) fn is_type_symbol_accessible_at(
        &mut self,
        symbol: Sym,
        file: FileId,
        scope: ScopeId,
    ) -> bool {
        self.with_enclosing_declaration(file, scope, |emit| {
            let at = emit.b.enclosing;
            emit.is_any_symbol_accessible(&[symbol], at, symbol, Meaning::Type, false, 0)
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
        file: FileId,
        scope: ScopeId,
    ) -> (bool, Vec<Sym>) {
        let (meaning, depth) = if is_parent {
            (Meaning::Namespace, 1)
        } else {
            (Meaning::None, 0)
        };
        let mut chain = self.with_enclosing_declaration(file, scope, |emit| {
            emit.symbol_chain_ex(symbol, meaning, false, depth)
        });
        let starts_with_global_this = chain.len() > 1 && chain[0] == GLOBAL_THIS;
        if starts_with_global_this {
            chain.remove(0);
        }
        (starts_with_global_this, chain)
    }

    /// `getSpecifierForModuleSymbol`
    pub(super) fn specifier_for_module_symbol_at(
        &mut self,
        module: Sym,
        file: FileId,
        scope: ScopeId,
    ) -> String {
        self.with_enclosing_declaration(file, scope, |emit| {
            emit.specifier_for_module_symbol(module, ResolutionMode::None)
        })
    }

    /// The specifier of the import type `symbolToTypeNode` writes for `module`, and its `resolution-mode` attribute.
    pub(super) fn import_type_specifier_at(
        &mut self,
        module: Sym,
        file: FileId,
        scope: ScopeId,
    ) -> (String, Option<&'static str>) {
        self.with_enclosing_declaration(file, scope, |emit| {
            emit.import_type_specifier_and_mode(module)
        })
    }
}

// ───────────────────────────── symbols ─────────────────────────────

impl<'p> Checker<'p> {
    /// `IsSymbolAccessible(symbol, enclosingDeclaration, meaning, false)` with `scope` of `file` for `enclosingDeclaration`. `meaning` is
    /// `SymFlags::TYPE`, `NAMESPACE` or `VALUE`. `with_export_value`: `SymbolFlagsValue | SymbolFlagsExportValue`.
    pub(super) fn is_symbol_accessible_at(
        &mut self,
        symbol: Sym,
        meaning: SymFlags,
        with_export_value: bool,
        file: FileId,
        scope: ScopeId,
    ) -> bool {
        let meaning = if meaning == SymFlags::TYPE {
            Meaning::Type
        } else if meaning == SymFlags::NAMESPACE {
            Meaning::Namespace
        } else if with_export_value {
            Meaning::ValueOfName
        } else {
            Meaning::Value
        };
        self.with_enclosing_declaration(file, scope, |emit| {
            let at = emit.b.enclosing;
            emit.is_symbol_accessible(symbol, at, meaning, false)
                .is_accessible()
        })
    }

    /// `isTriviallySerializableComputedName`, of the computed property name `[name]` written in `file`, with `scope` of
    /// `enclosing_file` for `enclosingDeclaration`.
    pub(super) fn is_trivially_serializable_computed_name_at(
        &mut self,
        file: FileId,
        name: ExprId,
        enclosing_file: FileId,
        scope: ScopeId,
    ) -> bool {
        self.with_enclosing_declaration(enclosing_file, scope, |emit| {
            if !is_entity_name_expression(emit.c.hir(file), name) {
                return false;
            }
            let Some((first, _)) = emit.first_identifier(file, name) else {
                return false;
            };
            let at = emit.b.enclosing;
            emit.is_entity_name_visible(first, None, Meaning::ValueOfName, at, false)
                .is_accessible()
        })
    }
}

impl<'p> DeclarationEmit<'_, 'p> {
    /// `exportTypeLinks.Get(symbol).target` of a symbol `cloneTypeAsModuleType` made, which has the flags, the name, the declarations,
    /// the parent and the exports of that. Any other symbol is given back.
    fn target_of_module_clone(&self, symbol: Sym) -> Sym {
        if symbol == GLOBAL_THIS || symbol.id.0 & MODULE_CLONE == 0 {
            return symbol;
        }
        let originating_import = Sym {
            file: symbol.file,
            id: SymbolId(symbol.id.0 & !MODULE_CLONE),
        };
        self.target_of_alias(originating_import)
            .unwrap_or(originating_import)
    }

    fn flags_of(&self, symbol: Sym) -> SymFlags {
        if symbol == GLOBAL_THIS {
            return SymFlags::VALUE_MODULE;
        }
        self.c.files().flags(self.target_of_module_clone(symbol))
    }

    fn decls_of(&self, symbol: Sym) -> Vec<(FileId, Decl)> {
        if symbol == GLOBAL_THIS {
            return Vec::new();
        }
        self.c.files().decls(self.target_of_module_clone(symbol))
    }

    fn name_of(&self, symbol: Sym) -> Atom {
        if symbol == GLOBAL_THIS {
            return known::globalThis;
        }
        self.c
            .files()
            .symbol(self.target_of_module_clone(symbol))
            .name
    }

    /// `symbolToString`
    fn symbol_text(&mut self, symbol: Sym) -> String {
        if symbol == GLOBAL_THIS {
            return "globalThis".to_owned();
        }
        let symbol = self.target_of_module_clone(symbol);
        self.c.symbol_to_string(symbol)
    }

    fn text(&self, range: (u32, u32)) -> String {
        self.c.source_text(self.file, range.0, range.1)
    }

    /// `symbol.Parent`. The binder notes what a declaration is written in whether or not it is exported: only what is among the
    /// exports has a parent.
    fn parent_of_symbol(&self, symbol: Sym) -> Option<Sym> {
        if symbol == GLOBAL_THIS {
            return None;
        }
        let symbol = self.target_of_module_clone(symbol);
        let files = self.c.files();
        let declared = files.symbol(symbol);
        if declared.parent.is_none() {
            return None;
        }
        let parent = files.sym(symbol.file, declared.parent);
        let is_exported = files.export(parent, declared.name) == Some(symbol)
            || files.export(parent, known::default) == Some(symbol);
        is_exported.then_some(parent)
    }

    /// `core.Some(symbol.Declarations, hasNonGlobalAugmentationExternalModuleSymbol)`
    fn is_external_module_symbol(&self, symbol: Sym) -> bool {
        let files = self.c.files();
        self.decls_of(symbol)
            .into_iter()
            .any(|(file, decl)| match decl {
                Decl::File => files.module(file).is_module(),
                Decl::Module(m) => matches!(self.c.hir(file)[m].name, ModuleName::String(_)),
                _ => false,
            })
    }

    /// `core.FirstNonNil(symbol.Declarations, c.getExternalModuleContainer)`
    fn external_module_container_of_symbol(&self, symbol: Sym) -> Option<Sym> {
        if symbol == GLOBAL_THIS {
            return None;
        }
        let files = self.c.files();
        for part in files.parts(self.target_of_module_clone(symbol)) {
            let (hir, bound) = (self.c.hir(part.file), self.c.bound(part.file));
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
        let files = self.c.files();
        let (hir, bound) = (self.c.hir(at.file), self.c.bound(at.file));
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
        if symbol == GLOBAL_THIS || symbol.id.0 & MODULE_CLONE != 0 {
            return symbol;
        }
        let files = self.c.files();
        let flags = files.flags(symbol);
        // `IsNonLocalAlias`
        if flags.contains(SymFlags::ALIAS)
            && !flags.intersects(SymFlags::VALUE | SymFlags::TYPE | SymFlags::NAMESPACE)
        {
            return match self.c.originating_import_of_alias(symbol) {
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

    /// `getExportsOfSymbol`
    fn exports_of_symbol(&mut self, symbol: Sym) -> Rc<Vec<(Atom, Sym)>> {
        let symbol = self.target_of_module_clone(symbol);
        if let Some(known) = self.exports.get(&symbol) {
            return Rc::clone(known);
        }
        let files = self.c.files();
        let exports = if symbol == GLOBAL_THIS {
            Vec::new()
        } else if files.flags(symbol).intersects(SymFlags::MODULE) {
            // `getExportsOfModuleWorker`
            files.all_exports_of(files.module_value(symbol)).to_vec()
        } else {
            files.exports(symbol)
        };
        let exports = Rc::new(exports);
        self.exports.insert(symbol, Rc::clone(&exports));
        exports
    }

    /// `compareSymbols`: by where they are first declared.
    fn compare_symbols(&self, a: Sym, b: Sym) -> std::cmp::Ordering {
        let place = |symbol: Sym| match self.decls_of(symbol).first() {
            Some(&(file, decl)) => {
                let start = self.c.declaration_name_start(file, decl).unwrap_or(0);
                (0, self.c.place_in_program_order(file, start))
            }
            None => (1, (false, 0, 0)),
        };
        place(a).cmp(&place(b)).then(a.cmp(&b))
    }

    fn compare_symbol_chains(&self, a: &[Sym], b: &[Sym]) -> std::cmp::Ordering {
        let mut order = a.len().cmp(&b.len());
        for (&x, &y) in a.iter().zip(b) {
            order = order.then_with(|| self.compare_symbols(x, y));
        }
        order
    }
}

// ───────────────────────────── what is visible ─────────────────────────────

impl<'p> DeclarationEmit<'_, 'p> {
    fn statements_of(&mut self, file: FileId) -> Rc<Statements> {
        if let Some(known) = self.statements.get(&file) {
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
        self.statements.insert(file, Rc::clone(&statements));
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
            Decl::ImportSpec(s) => {
                let import = hir
                    .imports
                    .iter()
                    .position(|import| import.named.range().contains(&s.idx()))?;
                self.statements_of(file).imports[import]
            }
            Decl::ExportSpec(s) => {
                let export = hir
                    .exports
                    .iter()
                    .position(|export| export.items.range().contains(&s.idx()))?;
                self.statements_of(file).exports[export]
            }
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
    fn is_declaration_visible(&mut self, file: FileId, decl: Decl) -> bool {
        // A name is bound by one node, whatever it is bound as.
        let decl = match decl {
            Decl::Param(pat) | Decl::Require(pat) => Decl::Var(pat),
            decl => decl,
        };
        if let Some(&known) = self.visibility.get(&(file, decl)) {
            return known;
        }
        let is_visible = self.determine_if_declaration_is_visible(file, decl);
        self.visibility.insert((file, decl), is_visible);
        is_visible
    }

    fn paint_visible(&mut self, file: FileId, decl: Decl) {
        let decl = match decl {
            Decl::Param(pat) | Decl::Require(pat) => Decl::Var(pat),
            decl => decl,
        };
        self.visibility.insert((file, decl), true);
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
                    !matches!(hir[around].name, ModuleName::Ident(_)) && !hir.has_module_syntax
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
    fn has_visible_declarations(
        &mut self,
        symbol: Sym,
        paints: bool,
    ) -> Option<Vec<(FileId, StmtId)>> {
        let mut aliases: Vec<(FileId, StmtId)> = Vec::new();
        let flags = self.flags_of(symbol);
        for (file, decl) in self.decls_of(symbol) {
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
                self.paint_visible(file, decl);
                if !aliases.contains(&(file, statement)) {
                    aliases.push((file, statement));
                }
            }
        }
        Some(aliases)
    }

    /// `isEntityNameVisible`, of a name that starts with the identifier `first`. `start`: where that is written in the file at hand,
    /// for `ErrorNode`.
    fn is_entity_name_visible(
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
            error_node: start.map(|start| (start, self.c.end_of_name_at(self.file, start))),
        };
        let Some(symbol) = found else {
            return result;
        };
        if meaning == Meaning::Type && self.flags_of(symbol).contains(SymFlags::TYPE_PARAMETER) {
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

impl<'p> DeclarationEmit<'_, 'p> {
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
                    .map(|id| files.sym(file, id))
            }
            Table::Exports(symbol) => files.export(symbol, name),
            Table::ResolvedExports(symbol) if symbol != GLOBAL_THIS => self
                .exports_of_symbol(symbol)
                .iter()
                .find(|export| export.0 == name)
                .map(|export| export.1),
            Table::ResolvedExports(_) | Table::Globals => {
                if name == known::globalThis {
                    return Some(GLOBAL_THIS);
                }
                files.globals.get(&name).copied()
            }
        }
    }

    /// `symbols[symbol.Name]`. The binder keeps a default export under the name it is declared with, and exports it as `default`.
    fn lookup_symbol(&mut self, table: Table, symbol: Sym) -> Option<Sym> {
        let by_name = self.lookup(table, self.name_of(symbol));
        if by_name == Some(symbol) {
            return by_name;
        }
        match self.lookup(table, known::default) {
            Some(default) if default == symbol => Some(default),
            _ => by_name,
        }
    }

    /// `getSymbolTableAliases`, each with the name it is in the table under.
    fn aliases_in_table(&mut self, table: Table) -> Rc<Vec<(Atom, Sym)>> {
        let files = self.c.files();
        let is_alias = |entry: &(Atom, Sym)| files.flags(entry.1).contains(SymFlags::ALIAS);
        let aliases: Vec<(Atom, Sym)> = match table {
            Table::Locals(file, scope) => {
                let bound = self.c.bound(file);
                let container = bound.scopes[scope.idx()].symbol;
                // `declareModuleMember`: an exported alias is among the exports alone.
                let is_exported = |entry: &(Atom, Sym)| {
                    container.is_some()
                        && files.export(files.sym(file, container), entry.0) == Some(entry.1)
                };
                bound
                    .table(bound.scopes[scope.idx()].locals)
                    .iter()
                    .map(|&(name, id)| (name, files.sym(file, id)))
                    .filter(|entry| is_alias(entry) && !is_exported(entry))
                    .collect()
            }
            Table::Exports(symbol) => files.each_export(symbol).filter(is_alias).collect(),
            Table::ResolvedExports(symbol) if symbol != GLOBAL_THIS => self
                .exports_of_symbol(symbol)
                .iter()
                .copied()
                .filter(is_alias)
                .collect(),
            Table::ResolvedExports(_) | Table::Globals => {
                if let Some(known) = &self.global_aliases {
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
                self.global_aliases = Some(Rc::clone(&aliases));
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
        if let Some(known) = self.chains.get(&key) {
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
        self.chains.insert(key, Rc::clone(&result));
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
        if let Some(found) = self.lookup_symbol(table, symbol)
            && self.is_accessible(
                symbol,
                at,
                meaning,
                found,
                None,
                ignores_qualification,
                visited,
            )
        {
            return vec![symbol];
        }
        let is_in_module = self.c.hir(at.file).has_module_syntax;
        let mut candidates: Vec<Vec<Sym>> = Vec::new();
        for &(name, alias) in self.aliases_in_table(table).iter() {
            if name == known::export_equals || name == known::default {
                continue;
            }
            let decls = self.decls_of(alias);
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
            candidates.sort_by(|a, b| self.compare_symbol_chains(a, b));
            return candidates.swap_remove(0);
        }
        if table == Table::Globals {
            return self.candidate_list_for_symbol(
                symbol,
                at,
                meaning,
                GLOBAL_THIS,
                GLOBAL_THIS,
                ignores_qualification,
                visited,
            );
        }
        Vec::new()
    }

    /// `resolveAlias`: what the alias is declared to stand for, and on from there while that is an alias and nothing else
    /// (`resolveSymbol`, `isNonLocalAlias`).
    fn resolve_alias(&mut self, alias: Sym) -> Option<Sym> {
        match self.c.originating_import_of_alias(alias) {
            Some(originating_import) => Some(module_clone(originating_import)),
            None => self.target_of_alias(alias),
        }
    }

    /// `resolve_alias`, with its target in place of a symbol `cloneTypeAsModuleType` made.
    fn target_of_alias(&self, alias: Sym) -> Option<Sym> {
        let files = self.c.files();
        let target = files.canonical(files.alias_target(alias)?);
        files.resolve_alias_as(
            target,
            SymFlags::VALUE | SymFlags::TYPE | SymFlags::NAMESPACE,
        )
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
        if symbol != from_table && Some(symbol) != resolved {
            return false;
        }
        !self.is_external_module_symbol(from_table)
            && (ignores_qualification || self.can_qualify_symbol(at, from_table, meaning, visited))
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
        match self.parent_of_symbol(from_table) {
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
            if found == symbol {
                return false;
            }
            let flags = self.flags_of(found);
            let resolves_alias = flags.contains(SymFlags::ALIAS)
                && !self
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
        if Some(container) == self.parent_of_symbol(symbol) {
            return Some(symbol);
        }
        if container == GLOBAL_THIS {
            return None;
        }
        if let Some(equals) = self.c.files().export(container, known::export_equals)
            && self.is_same_reference(equals, symbol)
        {
            return Some(container);
        }
        let exports = self.exports_of_symbol(container);
        let name = self.name_of(symbol);
        if let Some(quick) = exports.iter().find(|export| export.0 == name)
            && self.is_same_reference(quick.1, symbol)
        {
            return Some(quick.1);
        }
        let mut same = Vec::new();
        for &(_, exported) in exports.iter() {
            if self.is_same_reference(exported, symbol) {
                same.push(exported);
            }
        }
        same.into_iter().min_by(|&a, &b| self.compare_symbols(a, b))
    }

    /// `getAlternativeContainingModules`
    fn alternative_containing_modules(&mut self, symbol: Sym, at: Enclosing) -> Rc<Vec<Sym>> {
        if let Some(known) = self.containing_modules.get(&(symbol, at.file)) {
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
        self.containing_modules
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
        if let Some(module) = self.external_module_container_of_symbol(container)
            && let Some(equals) = self.c.files().export(module, known::export_equals)
            && self.is_same_reference(equals, container)
        {
            additional.push(module);
        }
        let reexports = self.alternative_containing_modules(symbol, at);
        let is_in_scope = self.flags_of(container).intersects(meaning.left().flags())
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
        if let Some(container) = self.parent_of_symbol(symbol)
            && !self.flags_of(symbol).contains(SymFlags::TYPE_PARAMETER)
        {
            return self.with_alternative_containers(container, symbol, at, meaning);
        }
        let files = self.c.files();
        let mut candidates: Vec<Sym> = Vec::new();
        for (file, decl) in self.decls_of(symbol) {
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
            if self.is_external_module_symbol(symbol) {
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
            symbol_name: self.symbol_text(initial),
            module_name: if had != initial {
                self.symbol_text(had)
            } else {
                String::new()
            },
            error_node: None,
        })
    }

    /// `IsSymbolAccessible`
    fn is_symbol_accessible(
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
            symbol_name: self.symbol_text(symbol),
            module_name: String::new(),
            error_node: None,
        };
        if let Some(module) = self.external_module_container_of_symbol(symbol)
            && Some(module) != self.external_module_container_of_scope(at)
        {
            result.accessibility = Accessibility::CannotBeNamed;
            result.module_name = self.symbol_text(module);
            // `ErrorNode`: `enclosingDeclaration`, if it is in JavaScript. A variable declaration is where the error is anyway.
            if self.c.hir(at.file).is_js && at.variable.is_none() && !self.b.is_in_made_up_scope {
                let start = self.c.skip_trivia_from(at.file, 0);
                result.error_node = Some((start, self.c.end_of_token_at(at.file, start)));
            }
        }
        result
    }
}

// ───────────────────────────── `SymbolTracker` ─────────────────────────────

impl<'p> DeclarationEmit<'_, 'p> {
    fn add_diagnostic(&mut self, range: (u32, u32), code: u32, args: Vec<String>) {
        self.found.push(Found {
            start: range.0,
            end: range.1,
            code,
            args,
            related: Vec::new(),
        });
    }

    /// Whether the member `m` is static, and whether it is written in a class declaration.
    fn place_of_member(&self, m: MemberId) -> (bool, bool) {
        let (hir, bound) = (self.c.hir(self.file), self.c.bound(self.file));
        let is_in_class_declaration = matches!(bound.member_owner[m.idx()], MemberOwner::Class(c)
            if matches!(bound.class_owner[c.idx()], ClassOwner::Stmt(_)));
        (
            hir[m].flags.contains(Flags::STATIC),
            is_in_class_declaration,
        )
    }

    fn name_range_of_member(&self, m: MemberId) -> (u32, u32) {
        (
            self.c.hir(self.file)[m].pos,
            self.c.end_of_member_name(self.file, m),
        )
    }

    fn range_of_pat(&self, pat: PatId) -> (u32, u32) {
        (
            self.c.hir(self.file)[pat].pos,
            self.c.end_of_pat(self.file, pat),
        )
    }

    /// `getSymbolAccessibilityDiagnostic`: the code, where the name the message starts with is written (nowhere if it starts with
    /// none), and where `GetErrorRangeForNode` puts the error. `None`: nothing is said.
    fn accessibility_diagnostic(&self, access: &Access) -> Option<(u32, (u32, u32), (u32, u32))> {
        let (hir, bound) = (self.c.hir(self.file), self.c.bound(self.file));
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
        Some(match self.context {
            Context::None => return None,
            Context::Variable(pat) => {
                let name = self.range_of_pat(pat);
                (by_module(4023, 4024, 4025), name, name)
            }
            Context::Property(m) => {
                let (is_static, is_in_class) = self.place_of_member(m);
                let name = self.name_range_of_member(m);
                (
                    of_property(is_static, is_in_class),
                    name,
                    self.c.error_range_of_member(self.file, m),
                )
            }
            Context::Assignment(e) => {
                let name = match hir[e].kind {
                    ExprKind::Assign { target, .. } => match hir[target].kind {
                        ExprKind::Dot { name_pos, .. } => {
                            (name_pos, self.c.end_of_name_at(self.file, name_pos))
                        }
                        _ => (0, 0),
                    },
                    _ => (0, 0),
                };
                (
                    of_property(false, false),
                    name,
                    (
                        self.c.start_of(self.file, e),
                        self.c.end_of_expr(self.file, e),
                    ),
                )
            }
            Context::ParameterProperty(p) => (
                of_property(false, true),
                self.range_of_pat(hir[p].pat),
                (hir[p].pos, self.c.end_of_param(self.file, p)),
            ),
            Context::Accessor(m) => {
                let (is_static, _) = self.place_of_member(m);
                let code = match (hir[m].kind == MemberKind::Setter, is_static) {
                    (true, true) => no_name_check(4034, 4035),
                    (true, false) => no_name_check(4036, 4037),
                    (false, true) => by_module(4038, 4039, 4040),
                    (false, false) => by_module(4041, 4042, 4043),
                };
                let name = self.name_range_of_member(m);
                (code, name, name)
            }
            Context::MethodName(m) => {
                let (is_static, is_in_class) = self.place_of_member(m);
                let code = if is_static {
                    by_module(4095, 4096, 4097)
                } else if is_in_class {
                    by_module(4098, 4099, 4100)
                } else {
                    no_name_check(4101, 4102)
                };
                (
                    code,
                    self.name_range_of_member(m),
                    self.c.error_range_of_member(self.file, m),
                )
            }
            Context::Return(f) => {
                let code = match hir[f].kind {
                    FnKind::ConstructSignature => no_name_check(4044, 4045),
                    FnKind::CallSignature => no_name_check(4046, 4047),
                    FnKind::IndexSignature => no_name_check(4048, 4049),
                    FnKind::Method => match bound.fns[f.idx()].owner {
                        FnOwner::Member(m) => match self.place_of_member(m) {
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
                        self.name_range_of_member(m)
                    }
                    FnOwner::Member(m) => (hir[m].pos, self.c.end_of_member(self.file, m)),
                    _ if hir[f].name.is_some() => (
                        hir[f].name_pos,
                        self.c.end_of_name_at(self.file, hir[f].name_pos),
                    ),
                    _ => self.c.error_range_of_fn(self.file, f),
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
                        FnOwner::Member(m) => match self.place_of_member(m) {
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
                    self.range_of_pat(hir[p].pat),
                    (hir[p].pos, self.c.end_of_param(self.file, p)),
                )
            }
            Context::TypeParameter(_, 0) => return None,
            Context::TypeParameter(tp, code) => {
                let start = hir[tp].pos;
                (
                    code,
                    (start, self.c.end_of_name_at(self.file, start)),
                    (start, self.c.end_of_type_param(self.file, tp)),
                )
            }
            Context::Heritage(code, name, node) => (code, name, node),
            Context::ImportEquals(i, statement) => (
                4000,
                (
                    hir[i].name_pos,
                    self.c.end_of_name_at(self.file, hir[i].name_pos),
                ),
                (hir[statement].pos, self.c.end_of_stmt(self.file, statement)),
            ),
            Context::TypeAlias(a) => (
                no_name_check(4084, 4081),
                (
                    hir[a].name_pos,
                    self.c.end_of_name_at(self.file, hir[a].name_pos),
                ),
                (
                    hir[hir[a].ty].pos,
                    self.c.end_of_type_node(self.file, hir[a].ty),
                ),
            ),
            Context::DefaultExport(start, end) => (4082, (0, 0), (start, end)),
            Context::DefinedExport(e) => {
                let (_, key) = crate::bind::define_property_call(hir, e)?;
                let key = (
                    self.c.start_of(self.file, key),
                    self.c.end_of_expr(self.file, key),
                );
                (by_module(4023, 4024, 4025), key, key)
            }
        })
    }

    /// `handleSymbolAccessibilityError`. Whether an error is reported.
    fn handle_symbol_accessibility_error(&mut self, access: Access) -> bool {
        match access.accessibility {
            Accessibility::Accessible => {
                for (file, statement) in access.aliases {
                    if file == self.file && !self.late_marked.contains(&statement) {
                        self.late_marked.push(statement);
                    }
                }
                return false;
            }
            // The checker says what it has to say of a name that means nothing.
            Accessibility::NotResolved => return false,
            Accessibility::NotAccessible | Accessibility::CannotBeNamed => {}
        }
        let Some((code, type_name, error_node)) = self.accessibility_diagnostic(&access) else {
            return false;
        };
        let mut args = Vec::with_capacity(3);
        if type_name != (0, 0) {
            args.push(self.text(type_name));
        }
        args.push(access.symbol_name);
        args.push(access.module_name);
        self.add_diagnostic(access.error_node.unwrap_or(error_node), code, args);
        true
    }

    /// `errorLocation`
    fn error_location(&self) -> Option<(u32, u32)> {
        match (self.error_name, self.fallback.last()) {
            (Some(name), _) => Some((name.start, name.end)),
            (None, Some(node)) => Some((node.start, node.end)),
            (None, None) => None,
        }
    }

    /// `errorDeclarationNameWithFallback`
    fn error_declaration_name(&self) -> String {
        match (self.error_name, self.fallback.last()) {
            (Some(name), _) if name.start < name.end => self.text((name.start, name.end)),
            (None, Some(node)) if node.name != (0, 0) => self.text(node.name),
            (None, Some(node)) => node.unnamed.to_owned(),
            _ => "(Missing)".to_owned(),
        }
    }

    /// What the transformer's tracker does when it is told.
    fn report_now(&mut self, report: Report) {
        let Some(location) = self.error_location() else {
            return;
        };
        let name = self.error_declaration_name();
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
                if self.error_name.is_some_and(|name| name.of_variable)
                    && let Some(found) = self.found.last_mut()
                {
                    found.related.push(Related {
                        at: Some((self.file, location.0, location.1)),
                        code: 9027,
                        args: vec![name],
                    });
                }
            }
        }
    }

    /// `SymbolTrackerImpl` of the node builder, and the `wrappingTracker` of a node that may be written again as it is: there
    /// a report waits until it is known what becomes of the node, and is an error of it.
    fn report(&mut self, report: Report) {
        self.b.reported_diagnostic = true;
        match self.b.boundaries.last_mut() {
            Some(boundary) => {
                boundary.had_error = true;
                boundary.deferred.push(report);
            }
            None => self.report_now(report),
        }
    }

    /// `ReportTruncationError`, which does not wait.
    fn report_truncation_error(&mut self) {
        if let Some(location) = self.error_location() {
            self.add_diagnostic(location, 7056, Vec::new());
        }
    }

    fn is_declared_in_javascript(&self, symbol: Sym) -> bool {
        self.decls_of(symbol)
            .iter()
            .any(|declaration| self.c.hir(declaration.0).is_js)
    }

    /// `TrackSymbol`
    fn track_symbol(&mut self, symbol: Sym, at: Enclosing, meaning: Meaning) {
        self.track(Tracked {
            symbol,
            at,
            meaning,
            as_local: false,
        });
    }

    fn track(&mut self, tracked: Tracked) {
        if self
            .flags_of(tracked.symbol)
            .contains(SymFlags::TYPE_PARAMETER)
        {
            return;
        }
        // See `Builder::may_be_named`. And how JavaScript exports what it declares is not followed.
        if !tracked.as_local
            && (self.b.may_be_named > 0 || self.is_declared_in_javascript(tracked.symbol))
            && !self
                .is_symbol_accessible(tracked.symbol, tracked.at, tracked.meaning, false)
                .is_accessible()
        {
            self.b.reported_diagnostic = true;
            return;
        }
        if let Some(boundary) = self.b.boundaries.last_mut() {
            boundary.tracked.push(tracked);
        } else {
            let access = if tracked.as_local {
                self.inaccessible(tracked.symbol, tracked.at)
            } else {
                self.is_symbol_accessible(tracked.symbol, tracked.at, tracked.meaning, true)
            };
            if self.handle_symbol_accessibility_error(access) {
                self.b.reported_diagnostic = true;
                return;
            }
        }
        self.b.tracked.push(tracked);
    }
}

// ───────────────────────────── `DeclarationTransformer` ─────────────────────────────

impl<'p> DeclarationEmit<'_, 'p> {
    /// `visitSourceFile`
    fn transform_source_file(&mut self) {
        self.precalculate_visibility();
        self.transform_expando_assignments();
        let hir = self.c.hir(self.file);
        for s in hir.ids(hir.body) {
            self.visit_statement(s);
        }
        self.transform_late_painted_statements();
    }

    /// `transformExpandoAssignment`, of each `f.name = value` that declares a property of a function. They come before all statements.
    fn transform_expando_assignments(&mut self) {
        let files = self.c.files();
        let (hir, bound) = (self.c.hir(self.file), self.c.bound(self.file));
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
            let host = files.sym(self.file, symbol);
            let decls = self.decls_of(host);
            let Some(&(file, decl)) = decls
                .iter()
                .find(|d| matches!(d.1, Decl::Fn(_) | Decl::Var(_)))
            else {
                continue;
            };
            if file != self.file {
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
                    let saved = self.context;
                    self.context = Context::Variable(pat);
                    self.transform_signature(function);
                    self.context = saved;
                }
            } else {
                // `shouldEmitFunctionProperties`
                let has_body = decls.iter().any(|d| {
                    matches!(d.1, Decl::Fn(f)
                        if d.0 == file && !matches!(hir[f].body, FnBody::None))
                });
                if !has_body || !self.is_declaration_visible(file, decl) {
                    continue;
                }
            }
            let saved = (self.error_name, self.context);
            self.context = Context::Assignment(e);
            if let ExprKind::Ident(right) = hir[value].kind
                && !is_parenthesized(self.c.hir(file), value)
            {
                // It is written `export { right as name }`.
                self.check_entity_name_visibility(right, hir[value].pos, Meaning::ValueOfName);
            } else {
                let function = self.c.type_of_symbol(host);
                if let Some(ty) = self.c.type_of_property(function, name) {
                    self.error_name = None;
                    self.b = Builder::new(self.enclosing, WRITE_CLASS_EXPRESSION_AS_TYPE_LITERAL);
                    self.serialize_declared_type(Declared::None, ty);
                    self.exit_context();
                }
            }
            (self.error_name, self.context) = saved;
        }
    }

    /// `PrecalculateDeclarationEmitVisibility`
    fn precalculate_visibility(&mut self) {
        let files = self.c.files();
        let (hir, bound) = (self.c.hir(self.file), self.c.bound(self.file));
        let any = SymFlags::VALUE | SymFlags::TYPE | SymFlags::NAMESPACE | SymFlags::ALIAS;
        for (i, statement) in hir.stmts.iter().enumerate() {
            if bound.stmt_parent[i] == Parent::None {
                continue;
            }
            match statement.kind {
                StmtKind::ExportDefault(e) | StmtKind::ExportAssign(e) => {
                    if let ExprKind::Ident(name) = hir[e].kind
                        && !is_parenthesized(self.c.hir(self.file), e)
                        && let Some(&scope) = bound.expr_scope.get(&e)
                    {
                        self.mark_linked_aliases(files.resolve_name(self.file, scope, name, any));
                    }
                }
                StmtKind::ExportNamed(export) if hir[export].spec.is_none() => {
                    let scope = bound.export_scope[export.idx()];
                    for spec in hir[export].items.iter() {
                        let target = files.resolve_name(self.file, scope, hir[spec].local, any);
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
                        && !is_parenthesized(self.c.hir(self.file), value)
                    {
                        let target = files.resolve_name(self.file, ScopeId(0), name, any);
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
        let hir = self.c.hir(self.file);
        for s in hir.ids(hir.body) {
            if matches!(hir[s].kind, StmtKind::Var(_)) {
                self.visit_statement(s);
            }
        }
        while !self.late_marked.is_empty() {
            let next = self.late_marked.remove(0);
            if matches!(hir[next].kind, StmtKind::Var(_)) {
                self.transform_top_level_declaration(next);
            }
        }
        self.found.retain(|found| found.code == 4023);
    }

    /// `transformCommonJSExport`, of each `Object.defineProperty(exports, "name", descriptor)` that is the first to export its name.
    fn transform_defined_exports(&mut self) {
        let files = self.c.files();
        if !files.module(self.file).is_commonjs() {
            return;
        }
        let hir = self.c.hir(self.file);
        for (_, symbol) in files.exports(files.file_symbol(self.file)) {
            let Some(&(file, Decl::ExportsProperty(e))) = self.decls_of(symbol).first() else {
                continue;
            };
            if file != self.file || crate::bind::define_property_call(hir, e).is_none() {
                continue;
            }
            let saved = (self.error_name, self.context);
            (self.error_name, self.context) = (None, Context::DefinedExport(e));
            self.b = Builder::new(self.enclosing, WRITE_CLASS_EXPRESSION_AS_TYPE_LITERAL);
            let ty = self.c.type_of_symbol(symbol);
            self.serialize_declared_type(Declared::None, ty);
            self.exit_context();
            (self.error_name, self.context) = saved;
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
                self.paint_visible(file, decl);
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
        match self.c.hir(self.file)[s].kind {
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
        while !self.late_marked.is_empty() {
            let next = self.late_marked.remove(0);
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
            self.enclosing = Enclosing {
                file: self.file,
                scope,
                variable: VarDeclId::NONE,
            };
        }
    }

    /// `transformTopLevelDeclaration`. Whether anything is written for the statement.
    fn transform_top_level_declaration(&mut self, s: StmtId) -> bool {
        self.late_marked.retain(|&marked| marked != s);
        let (hir, bound) = (self.c.hir(self.file), self.c.bound(self.file));
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
        if let Some(decl) = decl
            && !self.is_declaration_visible(self.file, decl)
        {
            return false;
        }
        if let StmtKind::Fn(f) = kind
            && self.is_implementation_of_overload(f)
        {
            return false;
        }
        let saved = (self.enclosing, self.context, self.error_name);
        let is_written = match kind {
            StmtKind::TypeAlias(a) => {
                self.enter(bound.alias_scope[a.idx()]);
                self.context = Context::TypeAlias(a);
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
                    self.c.end_of_name_at(self.file, hir[i].name_pos),
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
                self.context = Context::Return(f);
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
        (self.enclosing, self.context, self.error_name) = saved;
        is_written
    }

    /// `transformImportEqualsDeclaration`
    fn transform_import_equals(&mut self, i: ImportEqualsId, s: StmtId) -> bool {
        if !self.is_declaration_visible(self.file, Decl::ImportEquals(i)) {
            return false;
        }
        let hir = self.c.hir(self.file);
        if let ImportEqualsTarget::Entity(names) = hir[i].target
            && !names.is_empty()
        {
            let saved = self.context;
            self.context = Context::ImportEquals(i, s);
            // The name comes after the `=`.
            let after_name = self.c.end_of_name_at(self.file, hir[i].name_pos);
            let equals = self.c.skip_trivia_from(self.file, after_name);
            let start = self.c.skip_trivia_from(self.file, equals + 1);
            self.check_entity_name_visibility(hir.id_at(names, 0), start, Meaning::Namespace);
            self.context = saved;
        }
        true
    }

    /// `getBindingNameVisible`
    fn is_binding_name_visible(&mut self, pat: PatId) -> bool {
        let hir = self.c.hir(self.file);
        match hir[pat].kind {
            PatKind::Missing => false,
            PatKind::Ident(_) => self.is_declaration_visible(self.file, Decl::Var(pat)),
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
        let (hir, bound) = (self.c.hir(self.file), self.c.bound(self.file));
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
                self.context,
                self.error_name,
                self.suppresses_new_contexts,
            );
            self.enclosing = Enclosing {
                file: self.file,
                scope,
                variable: d,
            };
            if !self.suppresses_new_contexts {
                self.context = Context::Variable(pat);
            }
            if matches!(hir[pat].kind, PatKind::Ident(_)) {
                self.suppresses_new_contexts = true;
                self.ensure_type(Typed::Variable(d), false);
            } else {
                self.recreate_binding_pattern(pat, true);
            }
            (
                self.enclosing,
                self.context,
                self.error_name,
                self.suppresses_new_contexts,
            ) = saved;
        }
        true
    }

    /// `recreateBindingPattern`, and `walkBindingPattern`, which does not ask what is visible.
    fn recreate_binding_pattern(&mut self, pat: PatId, only_visible: bool) {
        let hir = self.c.hir(self.file);
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
        let (hir, bound) = (self.c.hir(self.file), self.c.bound(self.file));
        let class = hir[c];
        self.enter(bound.class_scope[c.idx()]);
        let name = if class.name.is_some() {
            (
                class.name_pos,
                self.c.end_of_name_at(self.file, class.name_pos),
            )
        } else {
            (0, 0)
        };
        self.error_name = class.name.is_some().then_some(NameNode {
            start: name.0,
            end: name.1,
            of_variable: false,
        });
        let (start, end) = self.c.error_range_of_stmt(self.file, s);
        self.fallback.push(FallbackNode {
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
        self.fallback.pop();
    }

    /// `transformClassExpressionToDeclaration`
    fn transform_class_expression(&mut self, c: ClassId) {
        let (hir, bound) = (self.c.hir(self.file), self.c.bound(self.file));
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
                self.c.end_of_name_at(self.file, class.name_pos),
            )
        } else {
            (0, 0)
        };
        self.visit_class_heritage(c, name, false);
        (self.enclosing, self.in_class_expression) = saved;
    }

    /// `buildClassMembers`
    fn build_class_members(&mut self, c: ClassId) {
        let hir = self.c.hir(self.file);
        let members = hir[c].members;
        // `GetFirstConstructorWithBody`
        let constructor = members.iter().find(|&m| {
            hir[m].kind == MemberKind::Constructor
                && hir[m].func.is_some()
                && !matches!(hir[hir[m].func].body, FnBody::None)
        });
        if let Some(constructor) = constructor {
            let saved = self.context;
            for p in hir[hir[constructor].func].params.iter() {
                if !hir[p].flags.contains(Flags::PARAMETER_PROPERTY) {
                    continue;
                }
                self.context = self.context_of_parameter(p);
                match hir[hir[p].pat].kind {
                    PatKind::Ident(_) => self.ensure_type(Typed::Parameter(p), false),
                    _ => self.recreate_binding_pattern(hir[p].pat, false),
                }
            }
            self.context = saved;
        }
        for m in members.iter() {
            self.visit_member(m);
        }
    }

    /// The heritage clauses of a class whose name is written at `name`. `is_declaration`: what it extends is written as a variable
    /// of its type if it is no name.
    fn visit_class_heritage(&mut self, c: ClassId, name: (u32, u32), is_declaration: bool) {
        let hir = self.c.hir(self.file);
        let class = hir[c];
        if class.extends.is_some() {
            let node = (
                self.c.start_of(self.file, class.extends),
                self.c.end_of_class_extends(self.file, c),
            );
            if is_entity_name_expression(self.c.hir(self.file), class.extends) {
                let saved = self.context;
                if !self.suppresses_new_contexts {
                    let code = match (is_declaration, name != (0, 0)) {
                        (false, _) => 4022,
                        (true, true) => 4020,
                        (true, false) => 4021,
                    };
                    self.context = Context::Heritage(code, name, node);
                }
                if let Some((first, start)) = self.first_identifier(self.file, class.extends) {
                    self.check_entity_name_visibility(first, start, Meaning::ValueOfName);
                }
                for argument in hir.ids(class.extends_args) {
                    self.visit_type(argument, false);
                }
                self.context = saved;
            } else if is_declaration && !matches!(hir[class.extends].kind, ExprKind::Null) {
                self.context = Context::Heritage(4020, name, node);
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
        let saved = self.context;
        if !self.suppresses_new_contexts {
            let range = (
                self.c.hir(self.file)[node].pos,
                self.c.end_of_type_node(self.file, node),
            );
            self.context = Context::Heritage(code, name, range);
        }
        self.visit_type(node, false);
        self.context = saved;
    }

    /// `transformExportAssignment`
    fn transform_export_assignment(&mut self, s: StmtId, e: ExprId, is_export_equals: bool) {
        let (hir, bound) = (self.c.hir(self.file), self.c.bound(self.file));
        if matches!(hir[e].kind, ExprKind::Ident(_))
            && !is_parenthesized(self.c.hir(self.file), e)
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
        let (start, end) = (hir[s].pos, self.c.end_of_stmt(self.file, s));
        self.context = Context::DefaultExport(start, end);
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
        self.fallback.push(FallbackNode {
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
        self.fallback.pop();
    }

    // ───────────────────────────── members and signatures ─────────────────────────────

    /// `GetFirstIdentifier`: the name, and where it is written.
    fn first_identifier(&self, file: FileId, e: ExprId) -> Option<(Atom, u32)> {
        let hir = self.c.hir(file);
        let first = &hir[first_identifier(hir, e)];
        match first.kind {
            ExprKind::Ident(name) => Some((name, first.pos)),
            _ => None,
        }
    }

    /// `IsImplementationOfOverload`
    fn is_implementation_of_overload(&self, f: FnId) -> bool {
        let files = self.c.files();
        let (hir, bound) = (self.c.hir(self.file), self.c.bound(self.file));
        if matches!(hir[f].body, FnBody::None) {
            return false;
        }
        match bound.fns[f.idx()].owner {
            FnOwner::Stmt(_) => {
                let symbol = bound.fn_symbol[f.idx()];
                symbol.is_some()
                    && files
                        .decls_of(files.sym(self.file, symbol))
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
        match self.c.bound(self.file).fns[f.idx()].owner {
            FnOwner::Member(m) => self.c.hir(self.file)[m].flags.contains(Flags::PRIVATE),
            _ => false,
        }
    }

    /// `createGetSymbolAccessibilityDiagnosticForNode`, of a parameter.
    fn context_of_parameter(&self, p: ParamId) -> Context {
        let (hir, bound) = (self.c.hir(self.file), self.c.bound(self.file));
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
        match self.c.hir(self.file)[f].kind {
            FnKind::ConstructorType | FnKind::ConstructSignature => 4006,
            FnKind::CallSignature => 4008,
            FnKind::Method => match self.c.bound(self.file).fns[f.idx()].owner {
                FnOwner::Member(m) => match self.place_of_member(m) {
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
            for tp in self.c.hir(self.file)[f].type_params.iter() {
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
        let function = self.c.hir(self.file)[f];
        self.visit_type(function.this_ty, false);
        for p in function.params.iter() {
            self.ensure_parameter(p);
        }
    }

    /// `ensureParameter`
    fn ensure_parameter(&mut self, p: ParamId) {
        let saved = self.context;
        if !self.suppresses_new_contexts {
            self.context = self.context_of_parameter(p);
        }
        self.visit_binding_name(self.c.hir(self.file)[p].pat);
        self.ensure_type(Typed::Parameter(p), true);
        self.context = saved;
    }

    /// `visitBindingName`
    fn visit_binding_name(&mut self, pat: PatId) {
        let hir = self.c.hir(self.file);
        match hir[pat].kind {
            PatKind::Object(props) => {
                for p in props.iter() {
                    if let PropKey::Computed(key) = hir[p].key
                        && is_entity_name_expression(self.c.hir(self.file), key)
                        && let Some((first, start)) = self.first_identifier(self.file, key)
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
        let saved = self.context;
        if !self.suppresses_new_contexts {
            self.context = Context::TypeParameter(tp, code);
        }
        let parameter = self.c.hir(self.file)[tp];
        self.visit_type(parameter.constraint, false);
        self.visit_type(parameter.default, false);
        self.context = saved;
    }

    /// `visitDeclarationSubtree`, of a member of a class, an interface or a type literal.
    fn visit_member(&mut self, m: MemberId) {
        let (hir, bound) = (self.c.hir(self.file), self.c.bound(self.file));
        let member = hir[m];
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
            && !(is_entity_name_expression(self.c.hir(self.file), key)
                && self.c.member_name(self.file, member.key).is_some())
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
            self.context,
            self.error_name,
            self.suppresses_new_contexts,
        );
        if f.is_some() {
            self.enter(bound.fns[f.idx()].scope);
        }
        if !self.suppresses_new_contexts {
            self.context = match member.kind {
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
                        self.visit_type(hir[f].this_ty, false);
                    }
                    self.ensure_type(Typed::Signature(f), false);
                }
                // `updateAccessorParamList`
                MemberKind::Setter => {
                    if !is_private {
                        self.visit_type(hir[f].this_ty, false);
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
            && let Some((first, start)) = self.first_identifier(self.file, key)
        {
            if !self.suppresses_new_contexts {
                self.context = match member.kind {
                    MemberKind::Getter | MemberKind::Setter => Context::Property(m),
                    MemberKind::Method => Context::MethodName(m),
                    _ => self.context,
                };
            }
            self.check_entity_name_visibility(first, start, Meaning::ValueOfName);
        }
        (
            self.enclosing,
            self.context,
            self.error_name,
            self.suppresses_new_contexts,
        ) = saved;
    }

    // ───────────────────────────── types that are written ─────────────────────────────

    /// `checkEntityNameVisibility`
    fn check_entity_name_visibility(&mut self, first: Atom, start: u32, meaning: Meaning) {
        let access = self.is_entity_name_visible(first, Some(start), meaning, self.enclosing, true);
        self.handle_symbol_accessibility_error(access);
    }

    /// `visitDeclarationSubtree`, of a type. `is_alias_body`: it is all a type alias stands for.
    fn visit_type(&mut self, node: TypeNodeId, is_alias_body: bool) {
        if node.is_none() || self.c.is_stack_low() {
            return;
        }
        let (hir, bound) = (self.c.hir(self.file), self.c.bound(self.file));
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
                    && let Some((first, start)) = self.first_identifier(self.file, expr)
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
            !is_optional
                && (!is_property
                    || at.scope.is_some()
                        && matches!(
                            self.c.bound(at.file).scopes[at.scope.idx()].kind,
                            ScopeKind::Fn(_)
                        ))
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

    /// The type of the property the member `m` of `file` declares.
    fn type_of_member(&mut self, file: FileId, m: MemberId) -> TypeId {
        let member = self.c.hir(file)[m];
        let mut flags = PropFlags::empty();
        if member.flags.contains(Flags::OPTIONAL) {
            flags |= PropFlags::OPTIONAL;
        }
        let prop = Prop {
            name: member.key.name().unwrap_or(Atom::NONE),
            flags,
            source: PropSource::Members(MemberList::One((file, m))),
            mapper: MapperId::IDENTITY,
        };
        self.c.type_of_prop(&prop, MapperId::IDENTITY)
    }

    /// `shouldPrintWithInitializer`: the literal type of a constant that is written with its value.
    fn literal_const_type(&mut self, node: Typed) -> Option<TypeId> {
        let hir = self.c.hir(self.file);
        let ty = match node {
            Typed::Variable(d) if hir[d].kind == VarKind::Const && hir[d].init.is_some() => {
                self.c.type_of_pat(self.file, hir[d].pat)
            }
            Typed::Property(m)
                if hir[m].flags.contains(Flags::READONLY) && hir[m].init.is_some() =>
            {
                self.type_of_member(self.file, m)
            }
            _ => return None,
        };
        self.c.is_fresh_literal(ty).then_some(ty)
    }

    /// `ensureType`
    fn ensure_type(&mut self, node: Typed, ignores_private: bool) {
        let (hir, bound) = (self.c.hir(self.file), self.c.bound(self.file));
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
                self.b = Builder::new(self.enclosing, 0);
                self.track_symbol(member, self.enclosing, Meaning::Value);
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
                if self.requires_adding_implicit_undefined(self.file, p, self.enclosing))
        {
            return self.visit_type(annotation, false);
        }
        let saved = (self.error_name, self.context);
        let name = match node {
            Typed::Variable(d) => Some(self.range_of_pat(hir[d].pat)),
            Typed::Element(pat) => Some(self.range_of_pat(pat)),
            Typed::Property(m) => Some(self.name_range_of_member(m)),
            Typed::Parameter(p) => Some(self.range_of_pat(hir[p].pat)),
            Typed::Signature(f) => match member_of(f) {
                Some(m) => matches!(
                    hir[m].kind,
                    MemberKind::Method | MemberKind::Getter | MemberKind::Setter
                )
                .then(|| self.name_range_of_member(m)),
                None => hir[f].name.is_some().then(|| {
                    (
                        hir[f].name_pos,
                        self.c.end_of_name_at(self.file, hir[f].name_pos),
                    )
                }),
            },
            Typed::Export(..) => None,
        };
        self.error_name = name.map(|(start, end)| NameNode {
            start,
            end,
            of_variable: matches!(node, Typed::Variable(_)),
        });
        if !self.suppresses_new_contexts {
            self.context = match node {
                Typed::Variable(d) => Context::Variable(hir[d].pat),
                Typed::Element(pat) => Context::Variable(pat),
                Typed::Property(m) => Context::Property(m),
                Typed::Parameter(p) => self.context_of_parameter(p),
                Typed::Signature(f) => match (hir[f].kind, member_of(f)) {
                    (FnKind::Getter | FnKind::Setter, Some(m)) => Context::Accessor(m),
                    (FnKind::Constructor, _) => Context::None,
                    (FnKind::Expr | FnKind::Arrow, _) => self.context,
                    _ => Context::Return(f),
                },
                Typed::Export(..) => self.context,
            };
        }
        let flags = if self.in_class_expression {
            0
        } else {
            WRITE_CLASS_EXPRESSION_AS_TYPE_LITERAL
        };
        self.b = Builder::new(self.enclosing, flags);
        let file = self.file;
        match node {
            Typed::Signature(f) => {
                let signature = self.c.sig_of_declaration(file, f);
                self.serialize_return_type_for_signature(signature);
            }
            Typed::Variable(d) => {
                let ty = self.c.type_of_pat(file, hir[d].pat);
                self.serialize_declared_type(Declared::Variable(file, d), ty);
            }
            Typed::Element(pat) => {
                let ty = self.c.type_of_pat(file, pat);
                self.serialize_declared_type(Declared::None, ty);
            }
            Typed::Property(m) => {
                let ty = self.type_of_member(file, m);
                self.serialize_declared_type(Declared::Member(file, m), ty);
            }
            Typed::Parameter(p) => {
                let ty = self.c.type_of_param(file, p);
                self.serialize_declared_type(Declared::Parameter(file, p), ty);
            }
            Typed::Export(s, e) => {
                let ty = self.type_of_export_assignment(s, e);
                self.serialize_declared_type(Declared::Export(file, e), ty);
            }
        }
        self.exit_context();
        self.error_name = saved.0;
        if !self.suppresses_new_contexts {
            self.context = saved.1;
        }
    }

    /// `getTypeOfSymbol`, of the symbol of `export default e` or `export = e`.
    fn type_of_export_assignment(&mut self, s: StmtId, e: ExprId) -> TypeId {
        let files = self.c.files();
        let (hir, bound) = (self.c.hir(self.file), self.c.bound(self.file));
        let container = match bound.stmt_parent[s.idx()] {
            Parent::Module(m) => files.sym(self.file, bound.module_symbol[m.idx()]),
            _ => files.file_symbol(self.file),
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
                .any(|&d| d == (self.file, Decl::ExportExpr(s)))
            && files.flags(symbol).contains(SymFlags::EXPORT_VALUE)
        {
            return self.c.type_of_symbol(symbol);
        }
        let ty = self.c.type_of_expr(self.file, e);
        self.c.widened(ty)
    }

    /// `CreateTypeOfExpression`, of what the class around extends.
    fn create_type_of_expression(&mut self, e: ExprId) {
        self.b = Builder::new(self.enclosing, WRITE_CLASS_EXPRESSION_AS_TYPE_LITERAL);
        // `serializeTypeForExpression`
        let ty = self.c.type_of_expr(self.file, e);
        let ty = self.c.regular(ty);
        let ty = self.c.widened(ty);
        self.type_to_node(ty);
        self.exit_context();
    }

    /// `exitContext`
    fn exit_context(&mut self) {
        if self.b.truncating {
            self.report_truncation_error();
        }
    }
}

// ───────────────────────────── `NodeBuilderImpl` ─────────────────────────────

impl<'p> DeclarationEmit<'_, 'p> {
    /// `checkTruncationLength`
    fn check_truncation_length(&mut self) -> bool {
        if !self.b.truncating {
            self.b.truncating = self.b.approximate_length > MAXIMUM_LENGTH;
        }
        self.b.truncating
    }

    /// `createElidedInformationPlaceholder`
    fn elided(&mut self) {
        self.b.approximate_length += 3;
    }

    fn length_of(&self, name: Atom) -> usize {
        if name.is_none() {
            return 0;
        }
        self.c.written_name(name).len()
    }

    fn is_value_symbol_accessible(&mut self, symbol: Sym) -> bool {
        self.is_symbol_accessible(symbol, self.b.enclosing, Meaning::Value, false)
            .is_accessible()
    }

    /// `getTypeFromTypeNode` of the node builder: under the mapper of the signature that is being written.
    fn type_from_type_node(&mut self, file: FileId, node: TypeNodeId) -> TypeId {
        let declared = self.c.type_from_node(file, node);
        self.c.instantiate(declared, self.b.mapper)
    }

    /// `symbolToTypeNode`
    fn symbol_to_type_node(&mut self, symbol: Sym, meaning: Meaning) {
        // `lookupSymbolChain`
        self.track_symbol(symbol, self.b.enclosing, meaning);
        let chain = if self.flags_of(symbol).contains(SymFlags::TYPE_PARAMETER) {
            vec![symbol]
        } else {
            self.symbol_chain(symbol, meaning, 0)
        };
        for &part in &chain[1..] {
            self.b.approximate_length += self.length_of(self.name_of(part)) + 1;
        }
        if self.is_external_module_symbol(chain[0]) {
            let specifier = self.import_type_specifier(chain[0], symbol);
            self.b.approximate_length += specifier.len() + 10;
        } else {
            self.b.approximate_length += 2 * (self.length_of(self.name_of(chain[0])) + 1);
        }
    }

    /// `typeToTypeNode`
    fn type_to_node(&mut self, ty: TypeId) {
        if self.b.depth >= MAXIMUM_DEPTH || self.c.is_stack_low() {
            return self.elided();
        }
        self.b.depth += 1;
        self.type_to_node_worker(ty);
        self.b.depth -= 1;
    }

    fn type_to_node_worker(&mut self, ty: TypeId) {
        let ty = self.c.reduced(ty);
        match self.c.data(ty) {
            TypeData::Intrinsic(intrinsic) => {
                self.b.approximate_length += match intrinsic {
                    Intrinsic::Unresolved | Intrinsic::Any | Intrinsic::Error => 3,
                    Intrinsic::Unknown => 0,
                    Intrinsic::Never => 5,
                    Intrinsic::Void | Intrinsic::Null | Intrinsic::NullDeclared => 4,
                    Intrinsic::Undefined | Intrinsic::Missing | Intrinsic::UndefinedDeclared => 9,
                    Intrinsic::String
                    | Intrinsic::Number
                    | Intrinsic::BigInt
                    | Intrinsic::Symbol
                    | Intrinsic::Object => 6,
                };
                return;
            }
            TypeData::Union(_) if ty == TypeId::BOOLEAN => {
                self.b.approximate_length += 7;
                return;
            }
            TypeData::Union(members) => {
                if let Some(enumeration) = self.enum_of_members(ty, members) {
                    return self.symbol_to_type_node(enumeration, Meaning::Type);
                }
            }
            TypeData::EnumLit { member, .. } => return self.enum_member_to_node(*member),
            TypeData::Enum { symbol, .. } => {
                let symbol = *symbol;
                if self.flags_of(symbol).contains(SymFlags::ENUM_MEMBER) {
                    return self.enum_member_to_node(symbol);
                }
                return self.symbol_to_type_node(symbol, Meaning::Type);
            }
            TypeData::StringLit { value, .. } => {
                self.b.approximate_length += self.length_of(*value) + 2;
                return;
            }
            TypeData::NumberLit { bits, .. } => {
                self.b.approximate_length +=
                    crate::atom::number_to_string(f64::from_bits(*bits)).len();
                return;
            }
            TypeData::BigIntLit { text, .. } => {
                self.b.approximate_length += self.length_of(*text) + 1;
                return;
            }
            TypeData::BoolLit { value, .. } => {
                self.b.approximate_length += if *value { 4 } else { 5 };
                return;
            }
            TypeData::UniqueSymbol { symbol, .. } => {
                return self.unique_symbol_to_node(*symbol);
            }
            TypeData::ThisParam(_) => {
                if self.b.flags & IN_OBJECT_TYPE_LITERAL != 0 {
                    self.b.encountered_error = true;
                    self.report(Report::InaccessibleThis);
                }
                self.b.approximate_length += 4;
                return;
            }
            _ => {}
        }
        let alias = self.c.alias_with_arguments_for_declaration_emit(ty);
        if let Some((alias, arguments)) = &alias
            && self
                .is_symbol_accessible(*alias, self.b.enclosing, Meaning::Type, false)
                .is_accessible()
        {
            self.map_to_type_nodes(arguments, false);
            return self.symbol_to_type_node(*alias, Meaning::Type);
        }
        // `getTypeFromTypeAliasReference`: an alias that is written `= A<X>` takes the place of `A`, which is the one the syntax leads to.
        // And nothing tells what a computed type is made from.
        let saved = self.b.may_be_named;
        if alias.is_some_and(|found| !found.1.is_empty())
            || matches!(
                self.c.data(ty),
                TypeData::Synth(_) | TypeData::ReverseMapped { .. }
            )
        {
            self.b.may_be_named += 1;
        }
        self.type_without_alias_to_node(ty);
        self.b.may_be_named = saved;
    }

    /// The rest of `typeToTypeNode`, of a type that goes by no alias.
    fn type_without_alias_to_node(&mut self, ty: TypeId) {
        match self.c.data(ty) {
            TypeData::Ref { target, args } => self.type_reference_to_node(ty, *target, args),
            TypeData::Tuple { elems, flags, .. } => {
                let mut types = Vec::with_capacity(elems.len());
                for (&elem, flag) in elems.iter().zip(flags.iter()) {
                    types.push(
                        self.c
                            .remove_missing_type(elem, flag.contains(ElemFlags::OPTIONAL)),
                    );
                }
                self.map_to_type_nodes(&types, false);
            }
            TypeData::TypeParam(..) => self.type_parameter_to_node(ty),
            TypeData::Union(members) => {
                if let Some((alias, arguments)) = self.alias_found_from_members(ty, members) {
                    self.map_to_type_nodes(&arguments, false);
                    return self.symbol_to_type_node(alias, Meaning::Type);
                }
                // `UnionType.origin`
                if let Some(origin) = self.c.p.union_origins.get(&ty) {
                    return self.list_to_node(&origin);
                }
                let types = self.format_union_types(ty);
                self.list_to_node(&types);
            }
            TypeData::Intersection(members) => {
                if let Some((alias, arguments)) = self.alias_found_from_members(ty, members) {
                    self.map_to_type_nodes(&arguments, false);
                    return self.symbol_to_type_node(alias, Meaning::Type);
                }
                self.list_to_node(members);
            }
            TypeData::Anon { .. }
            | TypeData::Fns { .. }
            | TypeData::Synth(_)
            | TypeData::ReverseMapped { .. } => self.anonymous_type_to_node(ty),
            // `getFinalArrayType`
            TypeData::EvolvingArray(element) => {
                let element = match *element {
                    TypeId::NEVER => TypeId::ANY,
                    element => element,
                };
                self.type_to_node(element);
            }
            TypeData::Keyof(of) => {
                self.b.approximate_length += 6;
                self.type_to_node(*of);
            }
            TypeData::Template { types, .. } => {
                for &part in types.iter() {
                    self.type_to_node(part);
                }
                self.b.approximate_length += 2;
            }
            // `Uppercase<T>`, `NoInfer<T>`
            TypeData::StringMapping { ty: of, .. } | TypeData::NoInfer(of) => {
                self.type_to_node(*of);
                self.b.approximate_length += 20;
            }
            TypeData::IndexedAccess { obj, index, .. } => {
                self.type_to_node(*obj);
                self.type_to_node(*index);
                self.b.approximate_length += 2;
            }
            TypeData::Cond { file, node, .. } => self.visit_and_transform_type(
                ty,
                Some(Identity::Conditional(*file, *node)),
                Self::conditional_type_to_node,
            ),
            // An alias that cannot be named is written out.
            TypeData::LazyAlias { .. } => {
                let forced = self.c.force(ty);
                if forced == ty {
                    return self.elided();
                }
                self.type_to_node(forced);
            }
            _ => {}
        }
    }

    /// `t.alias`, of a union or an intersection the printer knows none for. `instantiateTypeWorker` passes the alias on with its type
    /// arguments instantiated, and an alias that is written `= A<X>` takes the place of `A`. Here what `instantiate` makes does not
    /// say what it is made from. So the alias is looked for among the generic aliases of the files the members are written in: one
    /// that can be named where the type is wanted and comes to `ty` with the type arguments read off the members.
    fn alias_found_from_members(
        &mut self,
        ty: TypeId,
        members: &[TypeId],
    ) -> Option<(Sym, Vec<TypeId>)> {
        let files = self.c.files();
        let is_union = self.c.is_union(ty);
        let mut written_in: Vec<FileId> = Vec::new();
        // What stands for the type parameters around each member that is written somewhere.
        let mut mappers: Vec<MapperId> = Vec::new();
        for &member in members {
            let file = match self.c.data(member) {
                TypeData::Ref { target, .. } => target.file,
                TypeData::Anon {
                    origin: Origin::TypeLiteral(file, _) | Origin::Mapped(file, _),
                    mapper,
                }
                | TypeData::Cond { file, mapper, .. } => {
                    mappers.push(*mapper);
                    *file
                }
                TypeData::Fns { decls, mapper } => match decls.first() {
                    Some(first) => {
                        mappers.push(*mapper);
                        first.0
                    }
                    None => continue,
                },
                _ => continue,
            };
            if !written_in.contains(&file) {
                written_in.push(file);
            }
        }
        for file in written_in {
            let (hir, bound) = (self.c.hir(file), self.c.bound(file));
            for (a, alias) in hir.aliases.iter().enumerate() {
                if alias.type_params.is_empty()
                    || alias.ty.is_none()
                    || bound.alias_symbol[a].is_none()
                {
                    continue;
                }
                let symbol = files.sym(file, bound.alias_symbol[a]);
                // A class or an interface of the same name is what the name means. What `ty` is made from has been resolved.
                if files
                    .flags(symbol)
                    .intersects(SymFlags::CLASS | SymFlags::INTERFACE)
                {
                    continue;
                }
                let Some(declared) = self.c.p.declared_types.get(&symbol) else {
                    continue;
                };
                let body = hir[alias.ty].kind;
                let parameters = self.c.local_type_params_of_symbol(symbol);
                let mut arguments: Vec<Option<TypeId>> = vec![None; parameters.len()];
                let mut keys = None;
                let fits = match self.c.data(declared) {
                    TypeData::Union(patterns) | TypeData::Intersection(patterns)
                        if self.c.is_union(declared) == is_union
                            && patterns.len() == members.len()
                            && matches!(
                                body,
                                TypeNodeKind::Union(_)
                                    | TypeNodeKind::Intersection(_)
                                    | TypeNodeKind::Ref { .. }
                                    | TypeNodeKind::Mapped(_)
                            ) =>
                    {
                        patterns.iter().all(|&pattern| {
                            members.iter().any(|&member| {
                                let mut attempt = arguments.clone();
                                let fits =
                                    self.fits_alias(pattern, member, &parameters, &mut attempt, 0);
                                if fits {
                                    arguments = attempt;
                                }
                                fits
                            })
                        })
                    }
                    // `getIndexedAccessTypeOrUndefined`: what a union of keys selects is a union that has the alias of the indexed
                    // access type. `{ a: X[K] }["a"]` is `X[K]`, which has none.
                    &TypeData::IndexedAccess { index, .. } if is_union => {
                        let TypeNodeKind::IndexedAccess { index: written, .. } = body else {
                            continue;
                        };
                        if self.c.type_from_node(file, written) != index {
                            continue;
                        }
                        for (argument, &parameter) in arguments.iter_mut().zip(parameters.iter()) {
                            *argument = mappers
                                .iter()
                                .find_map(|&mapper| self.c.p.types.map(mapper, parameter));
                        }
                        keys = Some(index);
                        true
                    }
                    _ => false,
                };
                let Some(arguments) = arguments.into_iter().collect::<Option<Vec<TypeId>>>() else {
                    continue;
                };
                if !fits {
                    continue;
                }
                let mapper = self.c.mapper_from(&parameters, &arguments);
                if let Some(keys) = keys {
                    let keys = self.c.instantiate(keys, mapper);
                    if keys == TypeId::BOOLEAN || !self.c.is_union(keys) {
                        continue;
                    }
                }
                if self.c.instantiate(declared, mapper) == ty
                    && self
                        .is_symbol_accessible(symbol, self.b.enclosing, Meaning::Type, false)
                        .is_accessible()
                {
                    return Some((symbol, arguments));
                }
            }
        }
        None
    }

    /// Whether `actual` is `pattern` with something for each of `parameters`, which is noted in `arguments`.
    fn fits_alias(
        &self,
        pattern: TypeId,
        actual: TypeId,
        parameters: &[TypeId],
        arguments: &mut [Option<TypeId>],
        depth: u32,
    ) -> bool {
        if let Some(i) = parameters.iter().position(|&p| p == pattern) {
            return *arguments[i].get_or_insert(actual) == actual;
        }
        if depth > 8 || !self.c.has_type_variables(pattern) {
            return pattern == actual;
        }
        let (left, right) = match (self.c.data(pattern), self.c.data(actual)) {
            (
                TypeData::Ref {
                    target: a,
                    args: left,
                },
                TypeData::Ref {
                    target: b,
                    args: right,
                },
            ) if a == b && left.len() == right.len() => {
                return left
                    .iter()
                    .zip(right.iter())
                    .all(|(&l, &r)| self.fits_alias(l, r, parameters, arguments, depth + 1));
            }
            (
                TypeData::Anon {
                    origin: a,
                    mapper: left,
                },
                TypeData::Anon {
                    origin: b,
                    mapper: right,
                },
            ) if a == b => (*left, *right),
            (
                TypeData::Fns {
                    decls: a,
                    mapper: left,
                },
                TypeData::Fns {
                    decls: b,
                    mapper: right,
                },
            ) if a == b => (*left, *right),
            (
                TypeData::Cond {
                    file: a,
                    node: at,
                    mapper: left,
                },
                TypeData::Cond {
                    file: b,
                    node: other,
                    mapper: right,
                },
            ) if (a, at) == (b, other) => (*left, *right),
            // What instantiation resolves does not show its type arguments. The caller instantiates the alias with those that are
            // read off elsewhere, and compares.
            _ => return !self.c.is_object_type(pattern),
        };
        // What is written at one place mentions the same type parameters.
        let (left, right) = (self.c.p.types.mapping(left), self.c.p.types.mapping(right));
        left.len() == right.len()
            && left.iter().zip(right).all(|(l, r)| {
                l.0 == r.0 && self.fits_alias(l.1, r.1, parameters, arguments, depth + 1)
            })
    }

    /// The enum whose declared type is the union `ty` of `members`.
    fn enum_of_members(&mut self, ty: TypeId, members: &[TypeId]) -> Option<Sym> {
        let member = match *self.c.data(*members.first()?) {
            TypeData::EnumLit { member, .. } => member,
            TypeData::Enum { symbol, .. } => symbol,
            _ => return None,
        };
        let parent = self.parent_of_symbol(member)?;
        (self.c.enum_type_of_member(member) == ty).then_some(parent)
    }

    /// `E.A`: the enum is what is named.
    fn enum_member_to_node(&mut self, member: Sym) {
        let named = self.parent_of_symbol(member).unwrap_or(member);
        self.symbol_to_type_node(named, Meaning::Type);
    }

    /// What `typeof` names a `unique symbol` through: the variable that is declared as one, the class it is a static property of, the
    /// variable whose type is written as the type literal it is a property of. `Some(None)`: nothing. `None`: it cannot be told,
    /// or it is a property of the global `Symbol`.
    fn owner_of_unique_symbol(&self, symbol: UniqueSymbolDeclaration) -> Option<Option<Sym>> {
        let (file, m) = match symbol {
            UniqueSymbolDeclaration::Variable(variable) => return Some(Some(variable)),
            UniqueSymbolDeclaration::Member(file, m) => (file, m),
            UniqueSymbolDeclaration::SymbolConstructor => return None,
        };
        let files = self.c.files();
        let (hir, bound) = (self.c.hir(file), self.c.bound(file));
        let symbol_of = |pat: PatId| {
            let symbol = bound.pat_symbol[pat.idx()];
            symbol.is_some().then(|| files.sym(file, symbol))
        };
        match bound.member_owner[m.idx()] {
            MemberOwner::Class(c) => {
                let symbol = bound.class_symbol[c.idx()];
                symbol.is_some().then(|| Some(files.sym(file, symbol)))
            }
            // `getVariableDeclarationOfObjectLiteral`
            MemberOwner::TypeLiteral(node) => Some(
                hir.var_decls
                    .iter()
                    .find(|d| d.ty == node)
                    .and_then(|d| symbol_of(d.pat)),
            ),
            _ => None,
        }
    }

    fn unique_symbol_to_node(&mut self, symbol: UniqueSymbolDeclaration) {
        if self.b.flags & ALLOW_UNIQUE_ES_SYMBOL_TYPE == 0 {
            match self.owner_of_unique_symbol(symbol) {
                None => {}
                Some(Some(owner)) if self.is_value_symbol_accessible(owner) => {
                    self.b.approximate_length += 6;
                    return self.symbol_to_type_node(owner, Meaning::Value);
                }
                Some(_) => self.report(Report::InaccessibleUniqueSymbol),
            }
        }
        self.b.approximate_length += 13;
    }

    /// `mapToTypeNodes`
    fn map_to_type_nodes(&mut self, list: &[TypeId], is_bare_list: bool) {
        if list.is_empty() {
            return;
        }
        if self.check_truncation_length() {
            if !is_bare_list {
                return;
            }
            if list.len() > 2 {
                self.type_to_node(list[0]);
                return self.type_to_node(list[list.len() - 1]);
            }
        }
        for (i, &ty) in list.iter().enumerate() {
            if self.check_truncation_length() && i + 3 < list.len() - 1 {
                self.type_to_node(list[list.len() - 1]);
                break;
            }
            self.b.approximate_length += 2;
            self.type_to_node(ty);
        }
    }

    /// The members of a union or an intersection.
    fn list_to_node(&mut self, members: &[TypeId]) {
        if let [only] = members[..] {
            return self.type_to_node(only);
        }
        self.b.may_be_named += 1;
        self.map_to_type_nodes(members, true);
        self.b.may_be_named -= 1;
    }

    /// `formatUnionTypes`, as far as it matters which symbols are named.
    fn format_union_types(&mut self, ty: TypeId) -> Vec<TypeId> {
        let mut types = self.c.parts(ty).to_vec();
        // `UnionType.origin`: `T | undefined`, of a `T` that is a union with a name.
        let rest = self
            .c
            .filter(ty, |_, member| !member.is_undefined() && !member.is_null());
        if rest != ty
            && rest != TypeId::BOOLEAN
            && self.c.is_union(rest)
            && self
                .c
                .alias_with_arguments_for_declaration_emit(rest)
                .is_some()
        {
            types.retain(|member| member.is_undefined() || member.is_null());
            types.insert(0, rest);
        }
        types
    }

    /// `getParentSymbolOfTypeParameter`: the scope that declares it stands for the symbol.
    fn container_of_type_parameter(&self, parameter: TypeId) -> Option<(FileId, ScopeId)> {
        match *self.c.data(parameter) {
            TypeData::TypeParam(file, tp, _) => {
                Some((file, self.c.bound(file).type_param_scope[tp.idx()]))
            }
            _ => None,
        }
    }

    /// `typeReferenceToTypeNode`, of a reference to a class or an interface.
    fn type_reference_to_node(&mut self, ty: TypeId, target: Sym, args: &[TypeId]) {
        if let Some(element) = self.c.array_element(ty) {
            return self.type_to_node(element);
        }
        if self.b.flags & WRITE_CLASS_EXPRESSION_AS_TYPE_LITERAL != 0
            && self.flags_of(target).contains(SymFlags::CLASS)
            && !self.is_value_symbol_accessible(target)
        {
            // `createAnonymousTypeNode`, of the instance side.
            if self.should_emit_type_of_symbol(target, Meaning::Type) {
                return self.symbol_to_type_node(target, Meaning::Type);
            }
            if self.b.visited_types.contains(&ty) {
                return self.elided();
            }
            return self.visit_and_transform_type(
                ty,
                Some(Identity::Instance(target)),
                Self::object_type_to_node,
            );
        }
        let outer = self.c.outer_type_params_of_symbol(target);
        let all = self.c.all_type_params_of_symbol(target);
        // The groups of type arguments for the type parameters of what the declaration is inside of.
        let mut i = 0;
        while i < outer.len() && i < args.len() {
            let start = i;
            let container = self.container_of_type_parameter(outer[i]);
            i += 1;
            while i < outer.len() && self.container_of_type_parameter(outer[i]) == container {
                i += 1;
            }
            let end = i.min(args.len());
            if outer[start..end] != args[start..end] {
                self.map_to_type_nodes(&args[start..end], false);
            }
        }
        if !args.is_empty() {
            let mut count = all.len().min(args.len());
            // Those of iterables that are what they default to are left out.
            let is_iterable = [
                known::Iterable,
                known::IterableIterator,
                known::AsyncIterable,
                known::AsyncIterableIterator,
            ]
            .into_iter()
            .any(|name| self.c.global_type_symbol(name) == Some(target));
            while is_iterable && count > 0 {
                let Some(default) = self.c.default_of_type_param(all[count - 1]) else {
                    break;
                };
                if !self.c.is_identical(args[count - 1], default) {
                    break;
                }
                count -= 1;
            }
            if i < count {
                self.map_to_type_nodes(&args[i..count], false);
            }
        }
        self.symbol_to_type_node(target, Meaning::Type);
    }

    /// A type parameter where it is used: its name, or `infer T` in the `extends` type that declares it.
    fn type_parameter_to_node(&mut self, ty: TypeId) {
        let length = self
            .c
            .type_param_name(ty)
            .map_or(1, |name| self.length_of(name));
        if !self.b.infer_type_parameters.contains(&ty) {
            self.b.approximate_length += length;
            return;
        }
        self.b.approximate_length += length + 6;
        if let Some(constraint) = self.c.constraint_of_type_param(ty) {
            self.b.approximate_length += 9;
            self.type_to_node(constraint);
        }
    }

    /// `typeParameterToDeclaration`
    fn type_parameter_declaration(&mut self, parameter: TypeId) {
        if let Some(constraint) = self.c.constraint_of_type_param(parameter) {
            // `typeToTypeNodeHelperWithPossibleReusableTypeNode`
            let mut is_written = false;
            if let TypeData::TypeParam(file, tp, _) = *self.c.data(parameter) {
                let written = self.c.hir(file)[tp].constraint;
                if written.is_some() && self.type_from_type_node(file, written) == constraint {
                    is_written = self.try_reuse_existing_node(file, written);
                }
            }
            if !is_written {
                self.type_to_node(constraint);
            }
        }
        if let Some(default) = self.c.default_of_type_param(parameter) {
            self.type_to_node(default);
        }
    }

    // ───────────────────────────── anonymous object types ─────────────────────────────

    /// `getBaseTypeVariableOfClass(symbol) != nil`
    fn extends_type_variable(&mut self, class: Sym) -> bool {
        for (file, decl) in self.decls_of(class) {
            let Decl::Class(declaration) = decl else {
                continue;
            };
            let extends = self.c.hir(file)[declaration].extends;
            if extends.is_none() {
                continue;
            }
            let base = self.c.type_of_expr(file, extends);
            // `getBaseConstructorTypeOfClass`, `isConstructorType`: what cannot be constructed is the error type.
            if self.c.signatures(base, true).is_empty() {
                return false;
            }
            return match self.c.data(base) {
                TypeData::Intersection(parts) => {
                    parts.iter().any(|&part| self.c.is_type_variable(part))
                }
                _ => self.c.is_type_variable(base),
            };
        }
        false
    }

    /// `shouldEmitTypeOfSymbol`, but for functions: whether the type of a class, an enum or a namespace is written as its name.
    fn should_emit_type_of_symbol(&mut self, symbol: Sym, meaning: Meaning) -> bool {
        let flags = self.flags_of(symbol);
        if flags.intersects(SymFlags::ENUM | SymFlags::VALUE_MODULE) {
            return true;
        }
        if !flags.contains(SymFlags::CLASS) || self.extends_type_variable(symbol) {
            return false;
        }
        if self.b.flags & WRITE_CLASS_EXPRESSION_AS_TYPE_LITERAL == 0 {
            return true;
        }
        let is_declaration = self.decls_of(symbol).into_iter().any(|(file, decl)| {
            matches!(decl, Decl::Class(c)
                if matches!(self.c.bound(file).class_owner[c.idx()], ClassOwner::Stmt(_)))
        });
        is_declaration
            && self
                .is_symbol_accessible(symbol, self.b.enclosing, meaning, false)
                .is_accessible()
    }

    /// `shouldWriteTypeOfFunctionSymbol`: the symbol `typeof` names the type of a function by.
    fn symbol_to_query_function(&mut self, ty: TypeId) -> Option<Sym> {
        let files = self.c.files();
        let is_at_top = |bound: &Bound, statement: StmtId| {
            statement.is_some()
                && matches!(
                    bound.stmt_parent[statement.idx()],
                    Parent::File | Parent::Module(_)
                )
        };
        let symbol = match self.c.data(ty) {
            TypeData::Anon {
                origin: Origin::Function(symbol),
                ..
            } => {
                let symbol = *symbol;
                // `isNonLocalFunctionSymbol`
                let is_non_local = self.parent_of_symbol(symbol).is_some()
                    || self.decls_of(symbol).into_iter().any(|(file, decl)| {
                        let bound = self.c.bound(file);
                        matches!(decl, Decl::Fn(f)
                            if matches!(bound.fns[f.idx()].owner, FnOwner::Stmt(s) if is_at_top(bound, s)))
                    });
                if !is_non_local {
                    return None;
                }
                symbol
            }
            TypeData::Fns { decls, .. } => {
                let &(file, func) = decls.first()?;
                let (hir, bound) = (self.c.hir(file), self.c.bound(file));
                match bound.fns[func.idx()].owner {
                    // A function expression that initializes a variable at the top of a file or a namespace: the variable, unless its
                    // own type is being written.
                    FnOwner::Expr(e) if matches!(hir[func].kind, FnKind::Expr | FnKind::Arrow) => {
                        let Parent::VarInit(d) = bound.expr_parent[e.idx()] else {
                            return None;
                        };
                        let at = self.b.enclosing;
                        if !is_at_top(bound, bound.var_stmt[d.idx()])
                            || (at.file, at.variable) == (file, d)
                        {
                            return None;
                        }
                        let symbol = bound.pat_symbol[hir[d].pat.idx()];
                        if symbol.is_none() {
                            return None;
                        }
                        files.sym(file, symbol)
                    }
                    // A static method is named through its class.
                    FnOwner::Member(m) if hir[m].flags.contains(Flags::STATIC) => {
                        let MemberOwner::Class(c) = bound.member_owner[m.idx()] else {
                            return None;
                        };
                        let symbol = bound.class_symbol[c.idx()];
                        if symbol.is_none() {
                            return None;
                        }
                        files.sym(file, symbol)
                    }
                    _ => return None,
                }
            }
            _ => return None,
        };
        self.is_value_symbol_accessible(symbol).then_some(symbol)
    }

    /// `createAnonymousTypeNode`
    fn anonymous_type_to_node(&mut self, ty: TypeId) {
        let identity = match self.c.data(ty) {
            TypeData::Anon { origin, .. } => {
                let origin = *origin;
                match origin {
                    Origin::GlobalThis => {
                        return self.symbol_to_type_node(GLOBAL_THIS, Meaning::Value);
                    }
                    Origin::ClassStatic(symbol)
                    | Origin::EnumObject(symbol)
                    | Origin::Module(symbol)
                    | Origin::Function(symbol) => {
                        if self.should_emit_type_of_symbol(symbol, Meaning::Value) {
                            return self.symbol_to_type_node(symbol, Meaning::Value);
                        }
                    }
                    Origin::Namespace {
                        originating_import, ..
                    } => {
                        let symbol = module_clone(originating_import);
                        if self.should_emit_type_of_symbol(symbol, Meaning::Value) {
                            return self.symbol_to_type_node(symbol, Meaning::Value);
                        }
                    }
                    _ => {}
                }
                Some(Identity::Origin(origin))
            }
            TypeData::Fns { decls, .. } => decls
                .first()
                .map(|&(file, func)| Identity::Function(file, func)),
            _ => None,
        };
        if let Some(symbol) = self.symbol_to_query_function(ty) {
            return self.symbol_to_type_node(symbol, Meaning::Value);
        }
        if self.b.visited_types.contains(&ty) {
            // `getTypeAliasForTypeLiteral`
            if matches!(identity, Some(Identity::Origin(Origin::TypeLiteral(..))))
                && let Some((alias, _)) = self.c.alias_with_arguments_for_declaration_emit(ty)
            {
                return self.symbol_to_type_node(alias, Meaning::Type);
            }
            return self.elided();
        }
        self.visit_and_transform_type(ty, identity, Self::object_type_to_node);
    }

    /// `visitAndTransformType`
    fn visit_and_transform_type(
        &mut self,
        ty: TypeId,
        identity: Option<Identity>,
        transform: fn(&mut Self, TypeId),
    ) {
        let key = (ty, self.b.flags, self.b.enclosing);
        if let Some(cached) = self.b.serialized.get(&key) {
            let (truncating, added_length) = (cached.truncating, cached.added_length);
            for tracked in cached.tracked.clone() {
                self.track(tracked);
            }
            self.b.truncating |= truncating;
            self.b.approximate_length += added_length;
            return;
        }
        let mut depth = 0;
        if let Some(identity) = identity {
            match self
                .b
                .symbol_depth
                .iter_mut()
                .find(|entry| entry.0 == identity)
            {
                Some(entry) => {
                    depth = entry.1;
                    if depth <= 10 {
                        entry.1 = depth + 1;
                    }
                }
                None => self.b.symbol_depth.push((identity, 1)),
            }
            if depth > 10 {
                return self.elided();
            }
        }
        self.b.visited_types.push(ty);
        let around = std::mem::take(&mut self.b.tracked);
        let start = self.b.approximate_length;
        transform(self, ty);
        let added_length = self.b.approximate_length.saturating_sub(start);
        let tracked = std::mem::replace(&mut self.b.tracked, around);
        if !self.b.reported_diagnostic && !self.b.encountered_error {
            self.b.serialized.insert(
                key,
                Serialized {
                    truncating: self.b.truncating,
                    added_length,
                    tracked,
                },
            );
        }
        if let Some(at) = self
            .b
            .visited_types
            .iter()
            .rposition(|&visited| visited == ty)
        {
            self.b.visited_types.remove(at);
        }
        if let Some(identity) = identity
            && let Some(entry) = self
                .b
                .symbol_depth
                .iter_mut()
                .find(|entry| entry.0 == identity)
        {
            entry.1 = depth;
        }
    }

    /// `createTypeNodeFromObjectType`
    fn object_type_to_node(&mut self, ty: TypeId) {
        if self.c.mapped_origin(ty).is_some() && self.c.is_generic(ty) {
            return self.mapped_type_to_node(ty);
        }
        let Some(members) = self.c.members(ty) else {
            self.b.approximate_length += 2;
            return;
        };
        let (shape, mapper) = (members.shape(), members.mapper);
        let mut call = Vec::with_capacity(shape.call.len());
        for &signature in &shape.call {
            call.push(self.c.instantiate_sig(signature, mapper));
        }
        let mut construct = Vec::with_capacity(shape.construct.len());
        for &signature in &shape.construct {
            construct.push(self.c.instantiate_sig(signature, mapper));
        }
        if shape.props.is_empty() && shape.index.is_empty() {
            match (&call[..], &construct[..]) {
                ([], []) => {
                    self.b.approximate_length += 2;
                    return;
                }
                ([only], []) | ([], [only]) => return self.signature_to_declaration(*only),
                _ => {}
            }
        }
        // `abstract new () => T` cannot be written in a type literal: it is intersected with the rest.
        let (abstract_signatures, construct): (Vec<SigId>, Vec<SigId>) = construct
            .into_iter()
            .partition(|&signature| self.c.is_abstract_signature(signature));
        let has_abstract_signatures = !abstract_signatures.is_empty();
        for signature in abstract_signatures {
            self.b.approximate_length += 2;
            self.signature_to_declaration(signature);
        }
        let is_static_side = matches!(
            self.c.data(ty),
            TypeData::Anon {
                origin: Origin::ClassStatic(_),
                ..
            }
        );
        // `SymbolFlagsPrototype`
        let is_prototype = |prop: &Prop| {
            is_static_side
                && prop.name == known::prototype
                && matches!(prop.source, PropSource::Type(_))
        };
        let writes_classes = self.b.flags & WRITE_CLASS_EXPRESSION_AS_TYPE_LITERAL != 0;
        if has_abstract_signatures
            && call.is_empty()
            && construct.is_empty()
            && shape.index.is_empty()
            && shape
                .props
                .iter()
                .all(|prop| writes_classes && is_prototype(prop))
        {
            return;
        }
        let saved_flags = self.b.flags;
        self.b.flags |= IN_OBJECT_TYPE_LITERAL;
        // `createTypeNodesFromResolvedType`
        if !self.check_truncation_length() {
            for &signature in call.iter().chain(&construct) {
                self.signature_to_declaration(signature);
            }
            let is_reverse_mapped = matches!(self.c.data(ty), TypeData::ReverseMapped { .. });
            for info in &shape.index {
                // The placeholder is made whether or not it is used.
                self.elided();
                let key = self.c.instantiate(info.key, mapper);
                self.type_to_node(key);
                if !is_reverse_mapped {
                    let value = self.c.instantiate(info.value, mapper);
                    self.type_to_node(value);
                }
                self.b.approximate_length += if info.readonly { 14 } else { 5 };
            }
            let count = shape.props.len();
            for (i, prop) in shape.props.iter().enumerate() {
                if writes_classes {
                    if is_prototype(prop) {
                        continue;
                    }
                    if self.c.is_private_name(prop.name) {
                        let name = String::from_utf8_lossy(self.c.written_name(prop.name));
                        self.report(Report::PrivateInBaseOfClassExpression(name.into_owned()));
                    } else if prop
                        .flags
                        .intersects(PropFlags::PRIVATE | PropFlags::PROTECTED)
                    {
                        let name = self.c.atom_text(prop.name);
                        self.report(Report::PrivateInBaseOfClassExpression(name));
                    }
                }
                if self.check_truncation_length() && i + 3 < count - 1 {
                    self.add_property_to_element_list(ty, &shape.props[count - 1], mapper);
                    break;
                }
                self.add_property_to_element_list(ty, prop, mapper);
            }
        }
        self.b.flags = saved_flags;
        self.b.approximate_length += 2;
    }

    // ───────────────────────────── properties ─────────────────────────────

    /// `syntheticOrigin`: the property of the type a mapped type takes its modifiers from that the property `name` of `of` has its
    /// declarations from.
    fn origin_of_mapped_property(&mut self, of: TypeId, name: Atom) -> Option<Prop> {
        let (file, node, mapper) = self.c.mapped_origin(of)?;
        let mapped = self.c.mapped_decl(file, node);
        if self.c.hir(file)[mapped.param].constraint.is_none() {
            return None;
        }
        // `MappedTypeNameTypeKindRemapping`
        if let Some(renamed) = self.c.mapped_name_type(of) {
            let key = self.c.mapped_type_param(of);
            if !self.c.is_assignable(renamed, key) {
                return None;
            }
        }
        let (declared, _) = self.c.mapped_modifiers_source(file, node)?;
        let modifiers = self.c.instantiate(declared, mapper);
        let modifiers = self.c.apparent_type(modifiers);
        self.c.prop_of(modifiers, name).map(|found| found.0)
    }

    /// The start of `addPropertyToElementList`, of a property that a `unique symbol` names.
    fn track_late_bound_name(&mut self, prop: &Prop, depth: u32) {
        let (file, key) = match &prop.source {
            PropSource::Members(list) => match list.first() {
                Some(&(file, m)) => (file, self.c.hir(file)[m].key),
                None => return,
            },
            PropSource::Literal(file, p) => (*file, self.c.hir(*file)[*p].key),
            PropSource::Intersected(_, parts) => {
                if let Some(first) = parts.first()
                    && depth < 8
                {
                    self.track_late_bound_name(first, depth + 1);
                }
                return;
            }
            PropSource::Mapped(of, _) => {
                match self.origin_of_mapped_property(*of, prop.name) {
                    Some(origin) if depth < 8 => self.track_late_bound_name(&origin, depth + 1),
                    Some(_) => {}
                    // It has no declaration.
                    None => {
                        let name = self.c.prop_to_string(prop);
                        self.report(Report::NonSerializableProperty(name));
                    }
                }
                return;
            }
            PropSource::Type(_) => return self.track_name_of_copy(prop.name),
            _ => return,
        };
        // `hasLateBindableName`
        if let PropKey::Computed(e) = key
            && is_entity_name_expression(self.c.hir(file), e)
        {
            self.track_computed_name(file, e);
        }
    }

    /// The same for the copy a spread makes of a property, which does not keep where that is declared. Its name is taken to be written
    /// there as the `unique symbol` is declared: `[a]`, or `[N.a]` of one in a namespace or a class.
    fn track_name_of_copy(&mut self, name: Atom) {
        let files = self.c.files();
        if !files.atoms.is_symbol_name(name) {
            return;
        }
        let Some(name_type) = self.c.key_type_of_name(name) else {
            return;
        };
        let TypeData::UniqueSymbol { symbol, .. } = *self.c.data(name_type) else {
            return;
        };
        let Some(Some(owner)) = self.owner_of_unique_symbol(symbol) else {
            return;
        };
        let (hir, bound) = (self.c.hir(owner.file), self.c.bound(owner.file));
        let mut first = owner.id;
        loop {
            let parent = bound.symbols[first.idx()].parent;
            if parent.is_none()
                || !bound.symbols[parent.idx()].decls.iter().all(|decl| {
                    matches!(decl, Decl::Module(m) if matches!(hir[*m].name, ModuleName::Ident(_)))
                })
            {
                break;
            }
            first = parent;
        }
        let first = files.sym(owner.file, first);
        let at = self.b.enclosing;
        let name = files.symbol(first).name;
        match files.resolve_name(at.file, at.scope, name, SymFlags::VALUE) {
            Some(symbol) => self.track_symbol(symbol, at, Meaning::Value),
            None if self.c.hir(at.file).is_js => {}
            None => self.track(Tracked {
                symbol: first,
                at,
                meaning: Meaning::Value,
                as_local: true,
            }),
        }
    }

    /// `trackComputedName`
    fn track_computed_name(&mut self, file: FileId, e: ExprId) {
        let files = self.c.files();
        let hir = self.c.hir(file);
        let first = first_identifier(hir, e);
        let ExprKind::Ident(name) = hir[first].kind else {
            return;
        };
        let at = self.b.enclosing;
        if let Some(symbol) = files.resolve_name(at.file, at.scope, name, SymFlags::VALUE) {
            return self.track_symbol(symbol, at, Meaning::Value);
        }
        // The name means nothing where the type is written. What it means where the property is declared is a local of that place.
        let symbol = self.c.bound(file).expr_symbol[first.idx()];
        if symbol.is_some() && !self.c.hir(at.file).is_js {
            self.track(Tracked {
                symbol: files.sym(file, symbol),
                at,
                meaning: Meaning::Value,
                as_local: true,
            });
        }
    }

    /// `ObjectFlagsAnonymous`
    fn is_anonymous_object_type(&self, ty: TypeId) -> bool {
        match self.c.data(ty) {
            TypeData::Anon { origin, .. } => !matches!(origin, Origin::Mapped(..)),
            TypeData::Fns { .. } | TypeData::Synth(_) => true,
            _ => false,
        }
    }

    /// `shouldUsePlaceholderForProperty`
    fn should_use_placeholder_for_property(&self, property: &ReverseMappedProperty) -> bool {
        let stack = &self.b.reverse_mapped_stack;
        if stack
            .iter()
            .any(|on| on.owner == property.owner && on.name == property.name)
        {
            return true;
        }
        if let Some(last) = stack.last()
            && !self.is_anonymous_object_type(last.property_type)
        {
            return true;
        }
        stack.len() >= 3
            && property.mapped.is_some()
            && stack
                .iter()
                .rev()
                .take(4)
                .any(|on| on.mapped == property.mapped)
    }

    /// `addPropertyToElementList`
    fn add_property_to_element_list(&mut self, owner: TypeId, prop: &Prop, mapper: MapperId) {
        let reverse_mapped = match *self.c.data(owner) {
            TypeData::ReverseMapped { source, mapped, .. } => Some(ReverseMappedProperty {
                owner,
                name: prop.name,
                property_type: self
                    .c
                    .type_of_property(source, prop.name)
                    .unwrap_or(TypeId::ANY),
                mapped: self
                    .c
                    .mapped_origin(mapped)
                    .map(|origin| (origin.0, origin.1)),
            }),
            _ => None,
        };
        let uses_placeholder = reverse_mapped
            .as_ref()
            .is_some_and(|property| self.should_use_placeholder_for_property(property));
        let is_optional = prop.flags.contains(PropFlags::OPTIONAL);
        let is_readonly = prop.flags.contains(PropFlags::READONLY);
        // `getNonMissingTypeOfSymbol`
        let property_type = if uses_placeholder {
            TypeId::ANY
        } else {
            let ty = self.c.type_of_prop_for_inference(prop, mapper);
            self.c.remove_missing_type(ty, is_optional)
        };
        if self.c.files().atoms.is_symbol_name(prop.name) {
            self.track_late_bound_name(prop, 0);
        }
        self.b.approximate_length += self.length_of(prop.name) + 1;
        if prop.flags.contains(PropFlags::ACCESSOR) && self.c.is_known(property_type) {
            let write_type = self.c.write_type_of_prop(prop, mapper);
            let (is_in_class, is_field) = match &prop.source {
                PropSource::Members(list) => match list.first() {
                    Some(&(file, member)) => (
                        matches!(
                            self.c.bound(file).member_owner[member.idx()],
                            MemberOwner::Class(_)
                        ),
                        self.c.hir(file)[member].kind == MemberKind::Property,
                    ),
                    None => (false, false),
                },
                _ => (false, false),
            };
            if self.c.is_known(write_type)
                && !self.c.is_error_type(property_type)
                && !self.c.is_error_type(write_type)
                && (property_type != write_type || is_in_class)
            {
                if is_field || !prop.flags.contains(PropFlags::WRITE_ONLY) {
                    self.b.approximate_length += 3;
                    self.type_to_node(property_type);
                }
                if is_field || !is_readonly {
                    self.b.approximate_length += 11;
                    self.type_to_node(write_type);
                }
                return;
            }
        }
        let is_function = prop.flags.contains(PropFlags::METHOD)
            || matches!(prop.source, PropSource::Symbol(symbol)
                if self.flags_of(symbol).contains(SymFlags::FUNCTION));
        if is_function && !is_readonly {
            let has_properties = self.c.is_object_type(property_type)
                && self
                    .c
                    .members(property_type)
                    .is_some_and(|members| !members.shape().props.is_empty());
            if !has_properties {
                let callable = self
                    .c
                    .filter(property_type, |_, member| !member.is_undefined());
                let signatures = self.c.signatures(callable, false);
                for &signature in signatures.iter() {
                    self.signature_to_declaration(signature);
                }
                if !signatures.is_empty() || !is_optional {
                    return;
                }
            }
        }
        if uses_placeholder {
            self.elided();
        } else {
            if let Some(property) = reverse_mapped {
                self.b.reverse_mapped_stack.push(property);
            }
            // `symbol.ValueDeclaration`
            let declared = match &prop.source {
                PropSource::Members(list) => match list.first() {
                    Some(&(file, m)) if self.c.hir(file)[m].kind == MemberKind::Property => {
                        Declared::Member(file, m)
                    }
                    _ => Declared::None,
                },
                PropSource::Parameter(file, p) => Declared::Parameter(*file, *p),
                PropSource::Literal(file, p) => Declared::Literal(*file, *p),
                _ => Declared::None,
            };
            self.serialize_type_for_declaration(declared, property_type);
            if reverse_mapped.is_some() {
                self.b.reverse_mapped_stack.pop();
            }
        }
        if is_readonly {
            self.b.approximate_length += 9;
        }
    }

    // ───────────────────────────── signatures ─────────────────────────────

    /// `signatureToSignatureDeclarationHelper`
    fn signature_to_declaration(&mut self, signature: SigId) {
        // `enterSignatureScope`
        let saved_mapper = self.b.mapper;
        let saved_scope = self.b.is_in_made_up_scope;
        let declaration = self.c.sig_decl(signature);
        if declaration.is_some()
            && (!self.c.sig_params(signature).is_empty()
                || !self.c.sig_type_params(signature).is_empty())
        {
            self.b.is_in_made_up_scope = true;
        }
        if let Some((_, _, mapper)) = declaration
            && self
                .c
                .p
                .types
                .mapping(mapper)
                .iter()
                .any(|pair| pair.0 != pair.1)
        {
            self.b.mapper = mapper;
        }
        self.b.approximate_length += 3;
        for parameter in self.c.sig_type_params(signature) {
            self.type_parameter_declaration(parameter);
        }
        let parameters = self.c.sig_params(signature);
        for (i, parameter) in parameters.iter().enumerate() {
            // `getExpandedParameters`: a rest parameter that is a tuple is written as a parameter for each element, unless one that
            // is not the last stands for any number.
            if parameter.rest
                && i + 1 == parameters.len()
                && let TypeData::Tuple { elems, flags, .. } = self.c.data(parameter.ty)
                && !flags.split_last().is_some_and(|(_, before)| {
                    before
                        .iter()
                        .any(|flag| flag.intersects(ElemFlags::REST | ElemFlags::VARIADIC))
                })
            {
                for (&elem, flag) in elems.iter().zip(flags.iter()) {
                    let elem = if flag.contains(ElemFlags::REST) {
                        self.c.array_of(elem)
                    } else {
                        elem
                    };
                    self.type_to_node(elem);
                    self.b.approximate_length += self.length_of(parameter.name) + 5;
                }
                continue;
            }
            let declared = match declaration {
                Some((file, func, _)) if i < self.c.hir(file)[func].params.len() => {
                    Declared::Parameter(file, self.c.hir(file)[func].params.at(i))
                }
                _ => Declared::None,
            };
            self.serialize_type_for_declaration(declared, parameter.ty);
            self.b.approximate_length += self.length_of(parameter.name) + 3;
        }
        if let Some(this) = self.c.sig_this_type(signature) {
            self.type_to_node(this);
            self.b.approximate_length += 7;
        }
        self.serialize_return_type_for_signature(signature);
        self.b.mapper = saved_mapper;
        self.b.is_in_made_up_scope = saved_scope;
    }

    /// `createReturnFromSignature`: the type node that says what `func` returns.
    fn direct_return_type_node(&self, file: FileId, func: FnId) -> Option<TypeNodeId> {
        let (hir, bound) = (self.c.hir(file), self.c.bound(file));
        let function = hir[func];
        if function.ret.is_some() {
            return Some(function.ret);
        }
        // `typeFromSingleReturnExpression`
        if function.flags.intersects(Flags::ASYNC | Flags::GENERATOR) {
            return None;
        }
        let returned = match function.body {
            FnBody::None => return None,
            FnBody::Expr(e) => e,
            FnBody::Block(_) => {
                let returns = bound.fns[func.idx()].returns;
                if returns.len() != 1 {
                    return None;
                }
                let statement: StmtId = bound.ids(returns).next()?;
                if bound.stmt_parent[statement.idx()] != Parent::FnBody(func) {
                    return None;
                }
                match hir[statement].kind {
                    StmtKind::Return(e) if e.is_some() => e,
                    _ => return None,
                }
            }
        };
        match hir[returned].kind {
            ExprKind::As { ty, .. } => Some(ty),
            _ => None,
        }
    }

    /// `serializeReturnTypeForSignature`
    fn serialize_return_type_for_signature(&mut self, signature: SigId) {
        let returned = self.c.sig_return_for_inference(signature);
        let predicate = self.c.sig_predicate(signature);
        if let Some((file, func, _)) = self.c.sig_decl(signature)
            && let Some(node) = self.direct_return_type_node(file, func)
        {
            match (self.c.hir(file)[node].kind, predicate) {
                // `pseudoReturnTypeMatchesPredicate`
                (TypeNodeKind::Predicate { ty, .. }, Some(predicate)) => {
                    let is_the_same = match predicate.ty {
                        Some(narrowed) => {
                            ty.is_some() && self.c.type_from_node(file, ty) == narrowed
                        }
                        None => ty.is_none(),
                    };
                    if is_the_same {
                        if !self.try_reuse_existing_node(file, node) {
                            self.b.approximate_length += 7;
                        }
                        return;
                    }
                }
                (TypeNodeKind::Predicate { .. }, None) | (_, Some(_)) => {}
                (_, None) => {
                    if self.is_type_node_equivalent_to_type(file, node, returned, false) {
                        return self.reuse_type_node(file, node);
                    }
                }
            }
        }
        // `serializeInferredReturnTypeForSignature`
        match predicate {
            Some(predicate) => {
                if let Some(narrowed) = predicate.ty {
                    self.type_to_node(narrowed);
                }
            }
            None => self.type_to_node(returned),
        }
    }

    // ───────────────────────────── declarations ─────────────────────────────

    /// `PseudoTypeKindDirect`: the type node a declaration has its type from, its own or that of `e as T`.
    fn direct_type_node(&self, declared: Declared) -> Option<(FileId, TypeNodeId)> {
        let (file, annotation, initializer) = match declared {
            Declared::None => return None,
            Declared::Variable(file, d) => {
                let d = self.c.hir(file)[d];
                (file, d.ty, d.init)
            }
            Declared::Member(file, m) => {
                let m = self.c.hir(file)[m];
                (file, m.ty, m.init)
            }
            Declared::Parameter(file, p) => {
                let p = self.c.hir(file)[p];
                (file, p.ty, p.default)
            }
            Declared::Literal(file, p) => {
                let p = self.c.hir(file)[p];
                if p.kind != PropKind::Init {
                    return None;
                }
                (file, TypeNodeId::NONE, p.value)
            }
            Declared::Export(file, e) => (file, TypeNodeId::NONE, e),
        };
        if annotation.is_some() {
            return Some((file, annotation));
        }
        // `typeFromTypeAssertion`
        if initializer.is_some()
            && let ExprKind::As { ty, .. } = self.c.hir(file)[initializer].kind
        {
            return Some((file, ty));
        }
        None
    }

    /// `pseudoTypeEquivalentToType`, of a type node.
    fn is_type_node_equivalent_to_type(
        &mut self,
        file: FileId,
        node: TypeNodeId,
        ty: TypeId,
        is_optional: bool,
    ) -> bool {
        if ty == TypeId::UNRESOLVED || self.c.is_error_type(ty) {
            return true;
        }
        let written = self.c.type_from_node(file, node);
        if written == ty {
            return true;
        }
        if is_optional && self.c.filter(ty, |_, member| !member.is_undefined()) == written {
            return true;
        }
        self.c.regular(written) == self.c.regular(ty)
    }

    /// Whether `ty` is the `unique symbol` that `declared` declares.
    fn is_own_unique_symbol(&self, declared: Declared, ty: TypeId) -> bool {
        let TypeData::UniqueSymbol { symbol, .. } = *self.c.data(ty) else {
            return false;
        };
        let (of, own) = match declared {
            Declared::Variable(of, d) => {
                let variable = self.c.bound(of).pat_symbol[self.c.hir(of)[d].pat.idx()];
                if variable.is_none() {
                    return false;
                }
                let variable = self.c.files().sym(of, variable);
                (of, UniqueSymbolDeclaration::Variable(variable))
            }
            Declared::Member(of, m) => (of, UniqueSymbolDeclaration::Member(of, m)),
            _ => return false,
        };
        own == symbol && of == self.b.enclosing.file
    }

    /// `serializeTypeForDeclaration`, of a declaration whose type is `getTypeOfSymbol`.
    fn serialize_declared_type(&mut self, declared: Declared, ty: TypeId) {
        let ty = self.c.widen_literal(ty);
        self.serialize_type_for_declaration(declared, ty);
    }

    /// `serializeTypeForDeclaration`
    fn serialize_type_for_declaration(&mut self, declared: Declared, ty: TypeId) {
        let at = self.b.enclosing;
        let requires_undefined = matches!(declared, Declared::Parameter(file, p)
            if self.requires_adding_implicit_undefined(file, p, at));
        let ty = if requires_undefined {
            self.c.optional(ty)
        } else {
            ty
        };
        let saved_flags = self.b.flags;
        if self.is_own_unique_symbol(declared, ty) {
            self.b.flags |= ALLOW_UNIQUE_ES_SYMBOL_TYPE;
        }
        let mut is_written = false;
        if let Some((file, node)) = self.direct_type_node(declared) {
            // `isOptionalDeclaration`
            let is_optional = !requires_undefined
                && match declared {
                    Declared::Member(file, m) => {
                        self.c.hir(file)[m].flags.contains(Flags::OPTIONAL)
                    }
                    Declared::Parameter(file, p) => {
                        self.c.hir(file)[p].flags.contains(Flags::OPTIONAL)
                    }
                    _ => false,
                };
            is_written = self.is_type_node_equivalent_to_type(file, node, ty, is_optional);
            // With `| undefined` added to what is written.
            if !is_written && requires_undefined {
                let written = self.c.type_from_node(file, node);
                is_written = self.c.optional(written) == ty;
            }
            if is_written {
                self.reuse_type_node(file, node);
            }
        }
        if !is_written {
            self.type_to_node(ty);
        }
        self.b.flags = saved_flags;
    }

    // ───────────────────────────── mapped and conditional types ─────────────────────────────

    /// `createMappedTypeNodeFromType`
    fn mapped_type_to_node(&mut self, ty: TypeId) {
        let Some((file, node, mapper)) = self.c.mapped_origin(ty) else {
            return self.elided();
        };
        let mapped = self.c.mapped_decl(file, node);
        let over_keyof = if self.c.hir(file)[mapped.param].constraint.is_some() {
            self.c.mapped_modifiers_source(file, node)
        } else {
            None
        };
        match over_keyof {
            // `isMappedTypeWithKeyofConstraintDeclaration`: `keyof` stays, whatever it comes to.
            Some((declared, true)) => {
                let of = self.c.instantiate(declared, mapper);
                self.type_to_node(of);
            }
            _ => {
                let keys = self.c.mapped_keys(ty);
                self.type_to_node(keys);
            }
        }
        if let Some(name_type) = self.c.mapped_name_type(ty) {
            self.type_to_node(name_type);
        }
        let template = self.c.mapped_template(ty);
        let template = self
            .c
            .remove_missing_type(template, mapped.optional == MappedModifier::Add);
        self.type_to_node(template);
        self.b.approximate_length += 10;
    }

    /// `typeToTypeNodeOrCircularityElision`. `is_new`: `ty` stands for a type that is made for the occasion, which is not being written.
    fn type_to_node_or_circularity_elision(&mut self, ty: TypeId, is_new: bool) {
        if !self.c.is_union(ty) {
            return self.type_to_node(ty);
        }
        if self.b.visited_types.contains(&ty) {
            if !is_new {
                self.b.encountered_error = true;
                self.report(Report::CyclicStructure);
            }
            return self.elided();
        }
        self.visit_and_transform_type(ty, None, Self::type_to_node);
    }

    /// `conditionalTypeToTypeNode`
    fn conditional_type_to_node(&mut self, ty: TypeId) {
        let TypeData::Cond { file, node, .. } = *self.c.data(ty) else {
            return self.elided();
        };
        let TypeNodeKind::Cond {
            check: written,
            extends,
            ..
        } = self.c.hir(file)[node].kind
        else {
            return self.elided();
        };
        if self.check_truncation_length() {
            return self.elided();
        }
        let check = self.c.cond_piece(ty, 0);
        self.type_to_node(check);
        self.b.approximate_length += 15;
        // `FlagsGenerateNamesForShadowedTypeParams`: what goes member by member and is no type parameter any more is written
        // `C extends infer T ? T extends C ? .. : never : never`, and the branches are instantiated with that `T`.
        let as_declared = self.c.type_from_node(file, written);
        let has_new_parameter = matches!(
            self.c.data(as_declared),
            TypeData::TypeParam(..) | TypeData::ThisParam(_)
        ) && !matches!(
            self.c.data(check),
            TypeData::TypeParam(..) | TypeData::ThisParam(_)
        );
        if has_new_parameter {
            self.b.approximate_length += 37;
        }
        let mut declared = Vec::new();
        self.c.collect_infer_params(file, extends, &mut declared);
        let infer_type_parameters = declared
            .into_iter()
            .map(|parameter| self.c.type_param(file, parameter))
            .collect();
        let saved = std::mem::replace(&mut self.b.infer_type_parameters, infer_type_parameters);
        let extends = self.c.cond_piece(ty, 1);
        self.type_to_node(extends);
        self.b.infer_type_parameters = saved;
        let when_true = self.c.cond_piece(ty, 2);
        self.type_to_node_or_circularity_elision(when_true, has_new_parameter);
        let when_false = self.c.cond_piece(ty, 3);
        self.type_to_node_or_circularity_elision(when_false, has_new_parameter);
    }
}

// ───────────────────────────── type nodes that are written again (`nodecopy.go`) ─────────────────────────────

impl<'p> DeclarationEmit<'_, 'p> {
    fn had_error(&self) -> bool {
        self.b
            .boundaries
            .last()
            .is_some_and(|boundary| boundary.had_error)
    }

    /// `bound.markError(nil)`
    fn mark_error(&mut self) {
        if let Some(boundary) = self.b.boundaries.last_mut() {
            boundary.had_error = true;
        }
    }

    /// `reuseTypeNode`
    fn reuse_type_node(&mut self, file: FileId, node: TypeNodeId) {
        if !self.try_reuse_existing_node(file, node) {
            let ty = self.type_from_type_node(file, node);
            self.type_to_node(ty);
        }
    }

    /// `tryReuseExistingNodeHelper`. Whether the node can be written where the type is wanted.
    fn try_reuse_existing_node(&mut self, file: FileId, node: TypeNodeId) -> bool {
        // `createRecoveryBoundary`
        let boundary = Boundary {
            had_error: false,
            deferred: Vec::new(),
            tracked: Vec::new(),
            old_tracked: std::mem::take(&mut self.b.tracked),
            old_encountered_error: self.b.encountered_error,
            old_length: self.b.approximate_length,
        };
        self.b.boundaries.push(boundary);
        self.reuse_type(file, node);
        // `finalizeBoundary`
        let Some(boundary) = self.b.boundaries.pop() else {
            return false;
        };
        self.b.tracked = boundary.old_tracked;
        self.b.encountered_error = boundary.old_encountered_error;
        self.b.approximate_length = boundary.old_length;
        for report in boundary.deferred {
            self.report(report);
        }
        if boundary.had_error {
            return false;
        }
        for tracked in boundary.tracked {
            self.track(tracked);
        }
        // As long as it is in the source, which is not kept of the default library.
        let hir = self.c.hir(file);
        if !hir.text.is_empty() {
            let end = self.c.end_of_type_node(file, node);
            self.b.approximate_length += end.saturating_sub(hir[node].pos) as usize + 1;
        }
        true
    }

    /// The visitor of `getExistingNodeTreeVisitor`, at a type node: what cannot be written again is written from its type.
    fn reuse_type(&mut self, file: FileId, node: TypeNodeId) {
        if node.is_none() || self.had_error() {
            return;
        }
        if self.b.depth >= MAXIMUM_DEPTH || self.c.is_stack_low() {
            return self.mark_error();
        }
        // `startRecoveryScope`
        let tracked_top = self.b.tracked.len();
        let deferred_top = self
            .b
            .boundaries
            .last()
            .map_or(0, |boundary| boundary.deferred.len());
        self.b.depth += 1;
        self.reuse_type_worker(file, node);
        self.b.depth -= 1;
        if self.had_error()
            && !matches!(self.c.hir(file)[node].kind, TypeNodeKind::Predicate { .. })
        {
            // `endRecoveryScope`
            self.b.tracked.truncate(tracked_top);
            if let Some(boundary) = self.b.boundaries.last_mut() {
                boundary.had_error = false;
                boundary.deferred.truncate(deferred_top);
            }
            let ty = self.type_from_type_node(file, node);
            self.type_to_node(ty);
        }
    }

    /// `visitExistingNodeTreeSymbolsWorker`
    fn reuse_type_worker(&mut self, file: FileId, node: TypeNodeId) {
        let (hir, bound) = (self.c.hir(file), self.c.bound(file));
        match hir[node].kind {
            TypeNodeKind::Ref { .. }
            | TypeNodeKind::Typeof { .. }
            | TypeNodeKind::IndexedAccess { .. }
            | TypeNodeKind::Keyof(_) => {
                if !self.try_visit_simple_type_node(file, node) {
                    self.mark_error();
                }
            }
            TypeNodeKind::UniqueSymbol => {
                // It belongs to the declaration it is written in.
                let at = self.b.enclosing;
                let mut scope = bound.type_scope[node.idx()];
                while scope.is_some() && scope != at.scope {
                    scope = bound.scopes[scope.idx()].parent;
                }
                if file != at.file || scope.is_none() {
                    self.mark_error();
                }
            }
            TypeNodeKind::Import { args, .. } => {
                let declared = self.c.type_from_node(file, node);
                if self.c.instantiate(declared, self.b.mapper) != declared {
                    return self.mark_error();
                }
                for argument in hir.ids(args) {
                    self.reuse_type(file, argument);
                }
            }
            TypeNodeKind::Array(of) | TypeNodeKind::Readonly(of) => self.reuse_type(file, of),
            TypeNodeKind::Tuple(elems) => {
                for elem in elems.iter() {
                    self.reuse_type(file, hir[elem].ty);
                }
            }
            TypeNodeKind::Template { types, .. }
            | TypeNodeKind::Union(types)
            | TypeNodeKind::Intersection(types) => {
                for ty in hir.ids(types) {
                    self.reuse_type(file, ty);
                }
            }
            TypeNodeKind::Fn(f) => self.reuse_signature(file, f),
            TypeNodeKind::Object(members) => {
                let scope = bound.type_scope[node.idx()];
                for m in members.iter() {
                    self.reuse_member(file, m, scope);
                }
            }
            TypeNodeKind::Cond {
                check,
                extends,
                yes,
                no,
            } => {
                for part in [check, extends, yes, no] {
                    self.reuse_type(file, part);
                }
            }
            TypeNodeKind::Infer(tp) => {
                self.reuse_type(file, hir[tp].constraint);
            }
            TypeNodeKind::Mapped(m) => {
                let mapped = hir[m];
                self.reuse_type(file, hir[mapped.param].constraint);
                self.reuse_type(file, mapped.name_ty);
                self.reuse_type(file, mapped.ty);
            }
            TypeNodeKind::Predicate { ty, .. } => self.reuse_type(file, ty),
            TypeNodeKind::Error => self.mark_error(),
            TypeNodeKind::Keyword(_)
            | TypeNodeKind::StringLit(_)
            | TypeNodeKind::NumberLit(_)
            | TypeNodeKind::BigIntLit { .. }
            | TypeNodeKind::BoolLit(_) => {}
        }
    }

    /// What has parameters, in a type that is written again.
    fn reuse_signature(&mut self, file: FileId, f: FnId) {
        let hir = self.c.hir(file);
        let function = hir[f];
        for tp in function.type_params.iter() {
            self.reuse_type(file, hir[tp].constraint);
            self.reuse_type(file, hir[tp].default);
        }
        self.reuse_type(file, function.this_ty);
        for p in function.params.iter() {
            self.reuse_type(file, hir[p].ty);
        }
        self.reuse_type(file, function.ret);
    }

    /// A member of a type literal that is written in `scope`.
    fn reuse_member(&mut self, file: FileId, m: MemberId, scope: ScopeId) {
        let member = self.c.hir(file)[m];
        if let PropKey::Computed(key) = member.key {
            // What has no name that can be told is left out.
            if !is_entity_name_expression(self.c.hir(file), key)
                || self.c.member_name(file, member.key).is_none()
            {
                return;
            }
            if let Some((first, _)) = self.first_identifier(file, key)
                && self.track_existing_entity_name(file, scope, first, Meaning::ValueOfName)
            {
                self.mark_error();
            }
        }
        if member.kind != MemberKind::IndexSignature {
            self.reuse_type(file, member.ty);
        }
        if member.func.is_some() {
            self.reuse_signature(file, member.func);
        }
    }

    /// `tryVisitSimpleTypeNode`. `false`: it cannot be written again, and neither can what it is the operand of.
    fn try_visit_simple_type_node(&mut self, file: FileId, node: TypeNodeId) -> bool {
        let (hir, bound) = (self.c.hir(file), self.c.bound(file));
        let scope = bound.type_scope[node.idx()];
        match hir[node].kind {
            // `tryVisitTypeReference`
            TypeNodeKind::Ref { name, args } => {
                let names: Vec<Atom> = hir.ids(name).collect();
                let Some(&first) = names.first() else {
                    return false;
                };
                // `tryGetResolvedSymbolFromTypeNode`
                let Some(resolved) =
                    self.c
                        .files()
                        .resolve_entity(file, scope, &names, SymFlags::TYPE)
                else {
                    return false;
                };
                // A type parameter that stands for something else where the type is wanted.
                if self.flags_of(resolved).contains(SymFlags::TYPE_PARAMETER) {
                    let declared = self.c.type_from_node(file, node);
                    if self.c.instantiate(declared, self.b.mapper) != declared {
                        return false;
                    }
                }
                let meaning = if names.len() == 1 {
                    Meaning::Type
                } else {
                    Meaning::Namespace
                };
                let introduces_error = self.track_existing_entity_name(file, scope, first, meaning);
                for argument in hir.ids(args) {
                    self.reuse_type(file, argument);
                }
                !introduces_error || self.serialize_type_name(file, scope, &names, Meaning::Type)
            }
            // `tryVisitTypeQuery`
            TypeNodeKind::Typeof { name, args, .. } => {
                let names: Vec<Atom> = hir.ids(name).collect();
                let Some(&first) = names.first() else {
                    return false;
                };
                if first == known::this {
                    return false;
                }
                let introduces_error =
                    self.track_existing_entity_name(file, scope, first, Meaning::ValueOfName);
                for argument in hir.ids(args) {
                    self.reuse_type(file, argument);
                }
                !introduces_error || self.serialize_type_name(file, scope, &names, Meaning::Value)
            }
            // `tryVisitIndexedAccess`
            TypeNodeKind::IndexedAccess { obj, index } => {
                if !self.try_visit_simple_type_node(file, obj) {
                    return false;
                }
                self.reuse_type(file, index);
                true
            }
            // `tryVisitKeyOf`
            TypeNodeKind::Keyof(of) => self.try_visit_simple_type_node(file, of),
            _ => {
                self.reuse_type(file, node);
                true
            }
        }
    }

    /// `trackExistingEntityName`, of a name that starts with `first` and is written in `scope` of `file`. Whether the name does not
    /// mean the same, or cannot be used, where the type is wanted.
    fn track_existing_entity_name(
        &mut self,
        file: FileId,
        scope: ScopeId,
        first: Atom,
        meaning: Meaning,
    ) -> bool {
        let files = self.c.files();
        let at = self.b.enclosing;
        let here = files.resolve_name(file, scope, first, meaning.flags());
        let flags = here.map_or(SymFlags::empty(), |symbol| files.flags(symbol));
        // A type parameter can be named wherever it is still itself, a parameter in the signature that declares it.
        if flags.intersects(SymFlags::TYPE_PARAMETER | SymFlags::PARAMETER) {
            return false;
        }
        let there = files.resolve_name(at.file, at.scope, first, meaning.flags());
        let symbol = match (there, here) {
            (None, Some(_)) => return true,
            (None, None) => return false,
            (Some(there), Some(here)) if !self.is_same_reference(there, here) => return true,
            (Some(there), _) => there,
        };
        if !self
            .is_symbol_accessible(symbol, at, meaning, false)
            .is_accessible()
        {
            return true;
        }
        self.track_symbol(symbol, at, meaning);
        false
    }

    /// `serializeTypeName`. Whether what `names` means where it is written can be named where the type is wanted.
    fn serialize_type_name(
        &mut self,
        file: FileId,
        scope: ScopeId,
        names: &[Atom],
        meaning: Meaning,
    ) -> bool {
        let files = self.c.files();
        let Some(found) = files.resolve_entity(file, scope, names, meaning.flags()) else {
            return false;
        };
        // `resolveEntityName`: an alias that has not the meaning itself is followed.
        let symbol = if files.flags(found).intersects(meaning.flags()) {
            found
        } else {
            files.resolve_alias(found).unwrap_or(found)
        };
        if !self
            .is_symbol_accessible(symbol, self.b.enclosing, meaning, false)
            .is_accessible()
        {
            return false;
        }
        let resolved = files.resolve_alias(symbol).unwrap_or(symbol);
        self.symbol_to_type_node(resolved, meaning);
        true
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

impl<'p> DeclarationEmit<'_, 'p> {
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
    fn specifier_for_module_symbol(&mut self, symbol: Sym, mode: ResolutionMode) -> String {
        let importing = self.b.enclosing.file;
        let resolution_mode = self.resolution_mode_for_specifier(importing, mode);
        if let Some(known) = self.specifiers.get(&(symbol, importing, resolution_mode)) {
            return known.clone();
        }
        let mut target = None;
        let mut specifier = None;
        for (file, decl) in self.decls_of(symbol) {
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
        let specifier = match (specifier, target) {
            (Some(name), _) => name,
            (None, Some(target)) => self.module_specifier(target, importing, mode),
            (None, None) => String::new(),
        };
        self.specifiers
            .insert((symbol, importing, resolution_mode), specifier.clone());
        specifier
    }

    /// `sortByBestName`
    fn sort_by_best_name(&self, a: &(Sym, String), b: &(Sym, String)) -> std::cmp::Ordering {
        if a.1.is_empty() || b.1.is_empty() {
            return self.compare_symbols(a.0, b.0);
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
    fn symbol_chain(&mut self, symbol: Sym, meaning: Meaning, depth: u32) -> Vec<Sym> {
        self.symbol_chain_ex(symbol, meaning, true, depth)
    }

    /// `getSymbolChain`. `endOfChain`: `depth` is 0.
    fn symbol_chain_ex(
        &mut self,
        symbol: Sym,
        meaning: Meaning,
        yields_module: bool,
        depth: u32,
    ) -> Vec<Sym> {
        let at = self.b.enclosing;
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
                let name = if self.is_external_module_symbol(parent) {
                    self.specifier_for_module_symbol(parent, ResolutionMode::None)
                } else {
                    String::new()
                };
                parents.push((parent, name));
            }
            parents.sort_by(|a, b| self.sort_by_best_name(a, b));
            for (parent, _) in parents {
                let mut parent_chain =
                    self.symbol_chain_ex(parent, meaning.left(), yields_module, depth + 1);
                if parent_chain.is_empty() {
                    continue;
                }
                // The module says with `export =` that it is the symbol.
                let is_the_module = parent != GLOBAL_THIS
                    && self
                        .c
                        .files()
                        .export(parent, known::export_equals)
                        .is_some_and(|equals| self.is_same_reference(equals, symbol));
                if !is_the_module {
                    if chain.is_empty() {
                        let last = self
                            .alias_for_symbol_in_container(parent, symbol)
                            .unwrap_or(symbol);
                        chain.push(self.target_of_module_clone(last));
                    }
                    parent_chain.append(&mut chain);
                }
                chain = parent_chain;
                break;
            }
        }
        // A parent that is an external module is not written, unless the chain may start with it.
        if chain.is_empty()
            && (depth == 0 || yields_module || !self.is_external_module_symbol(symbol))
        {
            // What `cloneTypeAsModuleType` made is written as its target: it has the name and the declarations of that.
            chain.push(self.target_of_module_clone(symbol));
        }
        chain
    }

    /// The part of `symbolToTypeNode` that writes `import("specifier")` for `module`: the specifier, and the `resolution-mode` attribute.
    fn import_type_specifier_and_mode(&mut self, module: Sym) -> (String, Option<&'static str>) {
        let files = self.c.files();
        let is_node = files.options.resolves_like_node;
        // `GetEmitModuleFormatOfFile`
        let context_format = files.module(self.b.enclosing.file).implied_format;
        let target_format = self
            .decls_of(module)
            .into_iter()
            .find(|d| d.1 == Decl::File)
            .map(|d| files.module(d.0).implied_format);
        let mut specifier = String::new();
        let mut mode = None;
        // An `import` type that leads to an ECMAScript module only resolves as `import` does.
        if is_node
            && target_format == Some(ResolutionMode::Import)
            && context_format != ResolutionMode::Import
        {
            specifier = self.specifier_for_module_symbol(module, ResolutionMode::Import);
            mode = Some("import");
        }
        if specifier.is_empty() {
            specifier = self.specifier_for_module_symbol(module, ResolutionMode::None);
        }
        if is_node && specifier.contains("/node_modules/") {
            // Resolved the other way it may be found.
            let (swapped, swapped_mode) = if context_format == ResolutionMode::Import {
                (ResolutionMode::Require, "require")
            } else {
                (ResolutionMode::Import, "import")
            };
            let other = self.specifier_for_module_symbol(module, swapped);
            if !other.contains("/node_modules/") {
                return (other, Some(swapped_mode));
            }
        }
        (specifier, mode)
    }

    /// The same with its error. `module` is what the chain of names for `symbol` starts with.
    fn import_type_specifier(&mut self, module: Sym, symbol: Sym) -> String {
        let (specifier, mode) = self.import_type_specifier_and_mode(module);
        if specifier.contains("/node_modules/") && mode.is_none() {
            self.b.encountered_error = true;
            let files = self.c.files();
            let name = if self
                .parent_of_symbol(symbol)
                .is_some_and(|parent| files.export(parent, known::default) == Some(symbol))
            {
                "default".to_owned()
            } else {
                self.c.atom_text(self.name_of(symbol))
            };
            self.report(Report::LikelyUnsafeImportRequired(specifier.clone(), name));
        }
        specifier
    }
}
