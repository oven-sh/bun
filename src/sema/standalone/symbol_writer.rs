//! The symbol at every name of a file: the content TypeScript's test harness writes into `.symbols`
//! baselines (`typeWriterWalker.getSymbols`, `GetSymbolAtLocation`, `SymbolToStringEx`).
//!
//! The declarations of a [`Prop`] are those the binder and `lateBindMember` have merged with the
//! first one.

use super::enclosing_declaration::Enclosing;
use super::errors_declaration_emit::{EndOfChain, Meaning};
use super::print::{YieldModuleSymbol, quoted};
use super::services::symbol_at_location::{Declaration, Found, SymbolFinder, Undeclared};
use super::visit_node::VisitedNode;
use super::*;
use crate::bind::{Decl, FnOwner, ScopeId};

/// `typeWriterResult`
pub struct SymbolAtLocation {
    pub start: u32,
    pub end: u32,
    /// `Symbol(C.m, Decl(a.ts, 3, 11))`
    pub symbol_text: String,
}

/// `symbol.Parent` of a property.
enum PropertyParent {
    Symbol(Sym),
    /// A function expression that has no `SymbolId`, identified by the name
    /// `getNameOfSymbolAsWritten` returns for it.
    Named(String),
}

impl Checker<'_, '_> {
    /// `typeWriterWalker.getSymbols`, in no particular order. The file must have been checked, as in the harness.
    pub fn symbols_at_locations(&mut self, file: FileId) -> Vec<SymbolAtLocation> {
        let nodes = self.visited_nodes(file);
        let mut writer = SymbolWriter::new(self, file);
        for node in nodes {
            writer.write_symbol_of_visited_node(node);
        }
        writer.results
    }
}

struct SymbolWriter<'c, 'p, 's> {
    c: &'c mut Checker<'p, 's>,
    file: FileId,
    results: Vec<SymbolAtLocation>,
    /// `ECMALineMap`, by file.
    line_starts: FxHashMap<FileId, Vec<u32>>,
}

impl<'c, 'p, 's> SymbolWriter<'c, 'p, 's> {
    fn new(c: &'c mut Checker<'p, 's>, file: FileId) -> SymbolWriter<'c, 'p, 's> {
        let capacity = c.hir(file).exprs.len();
        SymbolWriter {
            c,
            file,
            results: Vec::with_capacity(capacity),
            line_starts: FxHashMap::default(),
        }
    }

    // ───────────────────────────── the walk ─────────────────────────────

    /// `writeTypeOrSymbol`, in the walk for symbols.
    fn write_symbol_of_visited_node(&mut self, node: VisitedNode) {
        let mut finder = SymbolFinder {
            c: self.c,
            file: self.file,
        };
        if let Some(found) = finder.get_symbol_at_visited_node(node.kind) {
            let scope = self.c.enclosing_scope_of_visited_node(self.file, node.kind);
            self.write_node(node.start, node.end, scope, &found);
        }
    }

    fn write_node(&mut self, start: u32, end: u32, scope: ScopeId, found: &Found) {
        let hir = self.c.hir(self.file);
        // `NodeFlagsInWithStatement`, `NodeFlagsReparsed`
        if hir.is_in_with(start) || hir.is_in_jsdoc(start) {
            return;
        }
        // The file scope substitutes for a scope the binder did not record.
        let scope = if scope.is_some() { scope } else { ScopeId(0) };
        let (name, declarations) = match found {
            Found::Symbol(symbol) => self.describe_symbol(*symbol, scope),
            Found::Property(prop, _) => self.describe_property(prop, scope),
            Found::Properties(prop, _) => {
                // `propSet`
                let parts = match &prop.source {
                    PropSource::Intersected(_, parts) => &parts[..],
                    _ => &[],
                };
                let is_declared = |part: &&Prop| !part.flags.contains(PropFlags::WRITE_PARTIAL);
                let props: Vec<&Prop> = parts.iter().filter(is_declared).collect();
                match props[..] {
                    [single] => self.describe_property(single, scope),
                    _ => self.describe_properties(&props, scope),
                }
            }
            Found::Anonymous { file, declaration } => (
                self.name_of_anonymous_symbol(*file, *declaration),
                vec![(*file, *declaration)],
            ),
            Found::Undeclared(undeclared) => (self.name_of_undeclared_symbol(undeclared), Vec::new()),
            Found::Prototype(class) => (
                self.qualified_by_parent(
                    Some(PropertyParent::Symbol(*class)),
                    "prototype".to_owned(),
                    scope,
                ),
                Vec::new(),
            ),
            Found::SyntheticDefault(module) => {
                let (starts_with_global_this, mut chain) =
                    self.c.lookup_symbol_chain_for_symbol_to_string(
                        *module,
                        true,
                        Enclosing::at_scope(self.file, scope),
                    );
                // `hasNonGlobalAugmentationExternalModuleSymbol`: a JSON file is not an external
                // module, so it is printed. It has an `export =`, which is what an import of it
                // resolves to, so no alias refers to the file.
                let is_json = self.c.hir(module.file).kind == FileKind::Json;
                if is_json {
                    chain = vec![*module];
                }
                // `getSymbolChain`: "symbol is a module export=, so it kinda looks like it's own parent".
                let is_its_own_parent = is_json
                    || self
                        .c
                        .files()
                        .export(*module, known::export_equals)
                        .is_some();
                let mut name = "default".to_owned();
                if !chain.is_empty() {
                    name = self.symbol_chain_to_string(starts_with_global_this, &chain);
                    if !is_its_own_parent {
                        push_access(&mut name, "default", false);
                    }
                }
                (name, Vec::new())
            }
            Found::IndexSignature {
                parent,
                declarations,
                ..
            } => (
                self.qualified_by_parent(
                    parent.map(PropertyParent::Symbol),
                    "__index".to_owned(),
                    scope,
                ),
                declarations
                    .iter()
                    .map(|&(file, member)| (file, Declaration::Bound(Decl::Member(member))))
                    .collect(),
            ),
        };
        let mut symbol_text = String::with_capacity(64);
        symbol_text.push_str("Symbol(");
        symbol_text.push_str(&name);
        for (count, &(file, declaration)) in declarations.iter().enumerate() {
            if count >= 5 {
                symbol_text.push_str(&format!(" ... and {} more", declarations.len() - count));
                break;
            }
            symbol_text.push_str(", ");
            self.push_declaration(&mut symbol_text, file, declaration);
        }
        symbol_text.push(')');
        self.results.push(SymbolAtLocation {
            start,
            end,
            symbol_text,
        });
    }

    /// `getNameOfSymbolAsWritten` for a symbol that only `declaration` declares.
    fn name_of_anonymous_symbol(&mut self, file: FileId, declaration: Declaration) -> String {
        let hir = self.c.hir(file);
        match declaration {
            Declaration::Expression(e) if matches!(hir[e].kind, ExprKind::Fn(_)) => {
                crate::messages::text(&self.c.name_of_function_expression(file, e))
            }
            Declaration::Expression(e) => self.name_of_object_literal(file, e),
            Declaration::TypeNode(node) => self.name_of_type_literal(file, node),
            // `DeclarationNameToString`
            Declaration::ThisParameter(function) => match hir[hir[hir[function].this_param].pat].kind {
                PatKind::Ident(name) => self.c.atoms().text(name).to_string(),
                _ => "(Missing)".to_owned(),
            },
            Declaration::Bound(_) => String::new(),
        }
    }

    fn name_of_undeclared_symbol(&self, undeclared: &Undeclared) -> String {
        match undeclared {
            Undeclared::Name(name) => crate::messages::text(&self.c.atom_text(*name)),
            Undeclared::Path(names) => {
                let path: Vec<_> = names
                    .iter()
                    .map(|&part| match part {
                        known::empty => "unknown".into(),
                        _ => self.c.atoms().text(part),
                    })
                    .collect();
                path.join(".")
            }
            Undeclared::Const => "const".to_owned(),
            Undeclared::ImportMeta => "ImportMetaExpression.meta".to_owned(),
            Undeclared::GlobalThis => "globalThis".to_owned(),
        }
    }

    /// `getNameOfSymbolAsWritten` for the symbol of an object literal.
    fn name_of_object_literal(&self, file: FileId, e: ExprId) -> String {
        crate::messages::text(&self.c.name_of_object_literal(file, e))
    }

    /// `getNameOfSymbolAsWritten` for the symbol of a type literal.
    fn name_of_type_literal(&self, file: FileId, node: TypeNodeId) -> String {
        crate::messages::text(&self.c.name_of_type_literal(file, node))
    }

    // ───────────────────────────── `symbol.Declarations` ─────────────────────────────

    fn declarations_of_symbol(&mut self, symbol: Sym) -> Vec<(FileId, Declaration)> {
        let files = self.c.files();
        match files.decls_of(symbol).first() {
            Some(&(file, first)) if files.flags(symbol).intersects(SymFlags::CLASS_MEMBER) => {
                self.declarations_of_member(file, first)
            }
            _ => {
                let declarations = files.decls_of(symbol);
                let bound = |&(file, decl): &(FileId, Decl)| (file, Declaration::Bound(decl));
                declarations.iter().map(bound).collect()
            }
        }
    }

    /// `getSymbolOfDeclaration(declaration).Declarations`
    fn declarations_of_member(
        &mut self,
        file: FileId,
        declaration: Decl,
    ) -> Vec<(FileId, Declaration)> {
        let declarations = self.c.declarations_of_member(file, declaration);
        let bound = |&(file, decl): &(FileId, Decl)| (file, Declaration::Bound(decl));
        declarations.iter().map(bound).collect()
    }

    fn declarations_of_property(&mut self, prop: &Prop, depth: u32) -> Vec<(FileId, Declaration)> {
        match &prop.source {
            PropSource::Literal(file, property) => {
                self.declarations_of_member(*file, Decl::Property(*property))
            }
            PropSource::Symbol(symbol) => self.declarations_of_symbol(*symbol),
            PropSource::Intersected(_, parts)
            | PropSource::Copy(_, parts, _)
            | PropSource::ReverseMapped(_, parts) => {
                let mut declarations = Vec::new();
                for part in parts.iter() {
                    declarations.extend(self.declarations_of_property(part, depth));
                }
                declarations
            }
            PropSource::Mapped(..) => {
                let mut declarations = Vec::new();
                for part in prop.declared_by_modifiers_property() {
                    declarations.extend(self.declarations_of_property(part, depth));
                }
                declarations
            }
            _ => Vec::new(),
        }
    }

    /// `symbol.Parent` of a property. The symbol of a type literal or an object literal is never
    /// printed.
    fn parent_of_property(&mut self, prop: &Prop) -> Option<PropertyParent> {
        let (file, member) = match &prop.source {
            PropSource::Symbol(symbol) => match self.c.files().value_declaration(*symbol)? {
                (file, Decl::Member(member)) => (file, member),
                // `bindExpandoPropertyAssignment`
                (file, Decl::Expando(first)) => {
                    let (bound, files) = (self.c.bound(file), self.c.files());
                    let parent = bound.symbols[bound.expr_symbol[first.idx()].idx()].parent;
                    let owner = &bound.symbols[parent.idx()];
                    return match (owner.name, owner.decls[0]) {
                        (known::anonymous_function, Decl::Fn(function)) => {
                            let FnOwner::Expr(e) = bound.fns[function.idx()].owner else {
                                return None;
                            };
                            Some(PropertyParent::Named(crate::messages::text(
                                &self.c.name_of_function_expression(file, e),
                            )))
                        }
                        (known::object_literal, _) => None,
                        _ => Some(PropertyParent::Symbol(files.sym(file, parent))),
                    };
                }
                _ => return self.c.declaring_class(prop).map(PropertyParent::Symbol),
            },
            PropSource::Copy(_, of, true) => return self.parent_of_property(&of[0]),
            _ => return None,
        };
        self.c
            .symbol_of_member_owner(file, member)
            .map(PropertyParent::Symbol)
    }

    // ───────────────────────────── `declaration.Pos()` ─────────────────────────────

    /// `Decl(a.ts, 3, 11)`
    fn push_declaration(&mut self, text: &mut String, file: FileId, declaration: Declaration) {
        let path = self.c.files().module(file).file_name();
        let file_name = &crate::messages::text(bun_paths::basename_posix(path));
        text.push_str("Decl(");
        text.push_str(file_name);
        // `isDefaultLibraryFile`
        if file_name.starts_with("lib.") && file_name.ends_with(".d.ts") {
            text.push_str(", --, --)");
            return;
        }
        let pos = self.pos_of_declaration(file, declaration);
        let (line, character) = self.line_and_character(file, pos);
        text.push_str(&format!(", {line}, {character})"));
    }

    /// `declaration.Pos()`
    fn pos_of_declaration(&self, file: FileId, declaration: Declaration) -> u32 {
        let hir = self.c.hir(file);
        // The start of the first token, and the flags of the declaration.
        let (start, flags) = match declaration {
            Declaration::Bound(decl) => match self.c.files().loc_of_declaration(file, decl) {
                Some(loc) => return loc.pos,
                None => (
                    self.c.files().start_of_declaration(file, decl),
                    match decl {
                        Decl::Fn(function) => hir[function].flags,
                        Decl::TypeParam(parameter) => hir[parameter].flags,
                        _ => Flags::empty(),
                    },
                ),
            },
            Declaration::Expression(e) => {
                (self.c.start_inside_parentheses(file, e), Flags::empty())
            }
            Declaration::TypeNode(node) => (hir[node].pos, Flags::empty()),
            Declaration::ThisParameter(function) => {
                let this = &hir[hir[function].this_param];
                (this.pos, this.flags)
            }
        };
        // The end of the previous token. `finishReparsedNode`: a node synthesized from a JSDoc tag
        // has the position of the tag, and the scanner of JSDoc comments has no trivia.
        if flags.contains(Flags::REPARSED) {
            start
        } else {
            self.c.end_of_token_before(file, start)
        }
    }

    /// `GetECMALineAndUTF16CharacterOfPosition`
    fn line_and_character(&mut self, file: FileId, pos: u32) -> (usize, usize) {
        let text = &self.c.hir(file).text[..];
        let starts = self
            .line_starts
            .entry(file)
            .or_insert_with(|| compute_ecma_line_starts(text));
        let line = starts.partition_point(|&start| start <= pos) - 1;
        let to = (pos as usize).min(text.len());
        let from = (starts[line] as usize).min(to);
        let character: usize = text[from..to].iter().map(|&byte| utf16_length(byte)).sum();
        (line, character)
    }

    // ───────────────────────────── `symbolToString` ─────────────────────────────

    fn describe_symbol(
        &mut self,
        symbol: Sym,
        at: ScopeId,
    ) -> (String, Vec<(FileId, Declaration)>) {
        // `lookupSymbolChainWorker`
        let flags = self.c.files().flags(symbol);
        let is_type_parameter = flags.contains(SymFlags::TYPE_PARAMETER);
        let (starts_with_global_this, chain) = if is_type_parameter {
            (false, vec![symbol])
        } else {
            self.c.lookup_symbol_chain_for_symbol_to_string(
                symbol,
                false,
                Enclosing::at_scope(self.file, at),
            )
        };
        (
            self.symbol_chain_to_string(starts_with_global_this, &chain),
            self.declarations_of_symbol(symbol),
        )
    }

    fn describe_property(
        &mut self,
        prop: &Prop,
        at: ScopeId,
    ) -> (String, Vec<(FileId, Declaration)>) {
        match &prop.source {
            // A member is handled as a property: `describe_symbol` cannot reach it.
            PropSource::Symbol(symbol) if !self.c.is_member_symbol(*symbol) => {
                return self.describe_symbol(*symbol, at);
            }
            // The name, the parent and the declarations of the symbol it is a copy of.
            PropSource::Copy(_, of, true) if of.len() == 1 => {
                return self.describe_property(&of[0], at);
            }
            PropSource::Intersected(_, parts) => {
                // `isInstantiation`: instantiations of one property that have the same type are one property.
                let mut prop_set: Vec<Prop> = Vec::new();
                for part in parts.iter() {
                    if let Some(single) = prop_set.first()
                        && single.source == part.source
                        && self.c.type_of_prop(single, MapperId::IDENTITY)
                            == self.c.type_of_prop(part, MapperId::IDENTITY)
                    {
                        continue;
                    }
                    prop_set.push(part.clone_in(self.c.arena));
                }
                return match &prop_set[..] {
                    [single] => self.describe_property(single, at),
                    _ => self.describe_properties(&prop_set.iter().collect::<Vec<_>>(), at),
                };
            }
            _ => {}
        }
        let declarations = self.declarations_of_property(prop, 0);
        if let Some(alias) = self
            .c
            .accessible_alias_of_property(prop, Enclosing::at_scope(self.file, at))
        {
            return (self.symbol_chain_to_string(false, &[alias]), declarations);
        }
        // `getNameOfSymbolAsWritten`: the source text of the name in the first declaration.
        let source = match declarations.first() {
            Some(&(
                file,
                Declaration::Bound(decl @ (Decl::Member(_) | Decl::ParameterProperty(_))),
            )) => {
                let symbol = self.c.bound(file).symbol_of_declaration(decl);
                PropSource::Symbol(self.c.files().sym(file, symbol))
            }
            Some(&(file, Declaration::Bound(Decl::Property(property)))) => {
                PropSource::Literal(file, property)
            }
            _ => prop.source.clone_in(self.c.arena),
        };
        let name = crate::messages::text(&self.c.prop_to_string(&Prop {
            source,
            ..prop.clone_in(self.c.arena)
        }));
        // `lookupSymbolChainWorker`: `class C<T> { T: number }` is one symbol, and a type parameter is not qualified.
        let is_type_parameter = |declaration: &(FileId, Declaration)| {
            matches!(declaration.1, Declaration::Bound(Decl::TypeParam(_)))
        };
        let parent = match declarations.iter().any(is_type_parameter) {
            true => None,
            false => self.parent_of_property(prop),
        };
        (self.qualified_by_parent(parent, name, at), declarations)
    }

    /// `createUnionOrIntersectionProperty`: all the declarations, and the parent of the value declaration if there is only one.
    fn describe_properties(
        &mut self,
        props: &[&Prop],
        at: ScopeId,
    ) -> (String, Vec<(FileId, Declaration)>) {
        let mut declarations = Vec::new();
        let mut first_value_declaration = None;
        let mut has_non_uniform_value_declaration = false;
        for prop in props {
            let own = self.declarations_of_property(prop, 0);
            match (first_value_declaration, own.first()) {
                (None, Some(&first)) => first_value_declaration = Some(first),
                (Some(known), Some(&first)) if known != first => {
                    has_non_uniform_value_declaration = true;
                }
                _ => {}
            }
            declarations.extend(own);
        }
        let Some(first) = props.first() else {
            return (String::new(), declarations);
        };
        let name = crate::messages::text(&self.c.prop_to_string(first));
        let parent = if has_non_uniform_value_declaration {
            None
        } else {
            self.parent_of_property(first)
        };
        (self.qualified_by_parent(parent, name, at), declarations)
    }

    /// `getSymbolChain` for a symbol that is in no symbol table: the chain of its parent, followed
    /// by `name`.
    fn qualified_by_parent(
        &mut self,
        parent: Option<PropertyParent>,
        name: String,
        at: ScopeId,
    ) -> String {
        let mut text = match parent {
            None => return name,
            Some(PropertyParent::Named(parent)) => parent,
            Some(PropertyParent::Symbol(parent)) => {
                let (starts_with_global_this, chain) =
                    self.c.lookup_symbol_chain_for_symbol_to_string(
                        parent,
                        true,
                        Enclosing::at_scope(self.file, at),
                    );
                if chain.is_empty() {
                    return name;
                }
                self.symbol_chain_to_string(starts_with_global_this, &chain)
            }
        };
        push_access(&mut text, &name, false);
        text
    }

    /// `createExpressionFromSymbolChain`
    fn symbol_chain_to_string(&mut self, starts_with_global_this: bool, chain: &[Sym]) -> String {
        let mut text = String::new();
        if starts_with_global_this {
            text.push_str("globalThis");
        }
        for (index, &symbol) in chain.iter().enumerate() {
            let is_initial = index == 0 && !starts_with_global_this;
            let name = self.get_name_of_symbol_as_written(symbol, is_initial);
            if is_initial {
                text = name;
            } else {
                let is_enum_member = self.c.files().flags(symbol).contains(SymFlags::ENUM_MEMBER);
                push_access(&mut text, &name, is_enum_member);
            }
        }
        text
    }

    /// `getNameOfSymbolAsWritten`, and the specifier `createExpressionFromSymbolChain` prints for
    /// an external module. `is_initial`: `FlagsInInitialEntityName`.
    fn get_name_of_symbol_as_written(&mut self, symbol: Sym, is_initial: bool) -> String {
        let is_default_export = self.c.files().symbol(symbol).name == known::default;
        // `isDefaultBindingContext`, at file granularity.
        if is_default_export && (!is_initial || symbol.file != self.file) {
            return "default".to_owned();
        }
        let name = crate::messages::text(&self.c.symbol_to_string(symbol));
        // `startsWithSingleOrDoubleQuote`: a function that `declare module "m" {}` augments keeps
        // its own name.
        if name.starts_with(['"', '\'']) && self.c.is_external_module_symbol(symbol) {
            let at = Enclosing::at_scope(self.file, ScopeId(0));
            let specifier = (self.c).specifier_for_module_symbol(symbol, at, ResolutionMode::None);
            // `getSpecifierForModuleSymbol`: without a file, `StripQuotes(symbol.Name)` (`isAmbientModuleSymbolName`).
            if !specifier.is_empty() {
                return crate::messages::text(&quoted(&specifier, b'"', true));
            }
        }
        name
    }
}

/// `print::push_access`
fn push_access(text: &mut String, name: &str, is_enum_member: bool) {
    let mut access = Vec::new();
    super::print::push_access(&mut access, name.as_bytes(), is_enum_member, true);
    text.push_str(&crate::messages::text(&access));
}

/// The number of UTF-16 code units of the character whose UTF-8 encoding contains `byte`, counted
/// at its first byte.
fn utf16_length(byte: u8) -> usize {
    match byte {
        0x80..=0xBF => 0,
        0xF0..=0xFF => 2,
        _ => 1,
    }
}

impl<'p, 's> Checker<'p, 's> {
    /// `lookupSymbolChain` as `symbolToExpression` calls it for `symbolToStringEx(symbol, enclosingDeclaration, SymbolFlagsNone,
    /// ..)`, without `yieldModuleSymbol`. Returns whether the chain starts with `globalThis`, and the rest of the chain.
    /// `is_parent`: `symbol` is the parent of a symbol that is in no symbol table, so `endOfChain` is false and the meaning is
    /// `SymbolFlagsNamespace`; the chain is then empty if `symbol` has no printable name.
    pub(super) fn lookup_symbol_chain_for_symbol_to_string(
        &mut self,
        symbol: Sym,
        is_parent: bool,
        at: Enclosing,
    ) -> (bool, Vec<Sym>) {
        let (meaning, end_of_chain) = if is_parent {
            (Meaning::Namespace, EndOfChain::No)
        } else {
            (Meaning::None, EndOfChain::Yes)
        };
        let mut chain =
            self.symbol_chain_ex(symbol, at, meaning, YieldModuleSymbol::No, end_of_chain);
        let starts_with_global_this =
            chain.len() > 1 && chain[0] == self.files().global_this_symbol;
        if starts_with_global_this {
            chain.remove(0);
        }
        (starts_with_global_this, chain)
    }
}
