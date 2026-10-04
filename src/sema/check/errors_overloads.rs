//! `checkFunctionOrConstructorSymbol`: 2383 2384 2385 2386 2387 2388 2389 2390 2391 2392 2393 2394 2512 2516 2813 2814.
//! `checkExportsOnMergedDeclarations`: 2395 2652.

use super::*;
use crate::bind::{Decl, MemberOwner, Parent, PatParent, ScopeKind, SymbolId};
use smallvec::SmallVec;

type Declaration = (FileId, Decl);

const FLAGS_TO_CHECK: Flags = Flags::EXPORT
    .union(Flags::AMBIENT)
    .union(Flags::PRIVATE)
    .union(Flags::PROTECTED)
    .union(Flags::ABSTRACT);

/// `DeclarationSpaces`
const EXPORT_VALUE: u8 = 1;
const EXPORT_TYPE: u8 = 2;
const EXPORT_NAMESPACE: u8 = 4;

impl Checker<'_, '_> {
    /// The checks that `checkFunctionOrMethodDeclaration`, `checkConstructorDeclaration` and the
    /// callers of `checkExportsOnMergedDeclarations` run on the declarations of `file`.
    pub(super) fn check_overloads(&mut self, file: FileId) {
        let (hir, bound, files) = (self.hir(file), self.bound(file), self.files());
        if hir.has_errors || hir.kind == FileKind::Json {
            return;
        }
        for i in 0..bound.symbols.len() {
            let (id, symbol) = (SymbolId(i as u32), &bound.symbols[i]);
            // "If localSymbol is defined on node then node itself is exported", or else "symbol might contain other declarations that
            // are exported".
            if symbol.export_symbol.is_some() && symbol.decls.len() > 1 {
                self.check_exports_on_merged_declarations(file, id);
            }
            let functions = symbol.decls.iter().filter_map(|&decl| {
                let function = self.function_of_declaration((file, decl))?;
                Some((decl, function))
            });
            let Some((first, function)) = functions.into_iter().next() else {
                continue;
            };
            // A single declaration with a body: no error is possible.
            if symbol.decls.len() == 1
                && !symbol.flags.contains(SymFlags::MERGED)
                && symbol.name != known::computed
                && has_body(&hir[function])
            {
                continue;
            }
            let sym = files.sym(file, id);
            // Checked once per symbol, regardless of which of its parts is reached.
            if sym.file == file && sym.id != id {
                continue;
            }
            // `hasBindableName`
            if let Decl::Member(m) = first
                && symbol.name == known::computed
                && self.declared_member_name(file, hir[m].key).is_none()
            {
                continue;
            }
            // "ignore javascript function declarations so that redeclaring a function in a JS file is not reported as a duplicate", but
            // "run check on export symbol" (`symbol.Parent != nil`).
            if hir.is_js
                && symbol.parent.is_none()
                && files.decls_of(sym).iter().all(|d| self.hir(d.0).is_js)
            {
                continue;
            }
            self.check_function_or_constructor_symbol(sym);
        }
    }

    /// `checkFunctionOrConstructorSymbolWorker`
    pub(super) fn check_function_or_constructor_symbol(&mut self, symbol: Sym) {
        let files = self.files();
        let flags = files.flags(symbol);
        // `getSymbolOfDeclaration`: a computed name resolves to the late-bound symbol.
        let declarations = match files.decls_of(symbol).first() {
            Some(&(file, first)) if flags.intersects(SymFlags::CLASS_MEMBER) => {
                self.declarations_of_member(file, first)
            }
            _ => files.decls_of(symbol),
        };
        let (mut some_node_flags, mut all_node_flags) = (Flags::empty(), FLAGS_TO_CHECK);
        let (mut some_have_question_token, mut all_have_question_token) = (false, true);
        let mut has_overloads = false;
        let mut body_declaration: Option<Declaration> = None;
        let mut last_seen_non_ambient_declaration: Option<Declaration> = None;
        let mut previous_declaration: Option<Declaration> = None;
        let is_constructor = flags.contains(SymFlags::CONSTRUCTOR);
        let mut duplicate_function_declaration = false;
        let mut multiple_constructor_implementation = false;
        let mut has_non_ambient_class = false;
        let mut function_declarations: SmallVec<[(Declaration, FnId); 4]> = SmallVec::new();
        for &node in declarations.iter() {
            let in_ambient_context = self.is_in_ambient_context(node);
            let in_ambient_context_or_interface = in_ambient_context
                || matches!(node.1, Decl::Member(m)
                    if !matches!(self.bound(node.0).member_owner[m.idx()], MemberOwner::Class(_)));
            if in_ambient_context_or_interface {
                // "check if declarations are consecutive only if they are non-ambient"
                previous_declaration = None;
            }
            if matches!(node.1, Decl::Class(_)) && !in_ambient_context {
                has_non_ambient_class = true;
            }
            let Some(function) = self.function_of_declaration(node) else {
                continue;
            };
            function_declarations.push((node, function));
            let current_node_flags = self.get_effective_declaration_flags(node, FLAGS_TO_CHECK);
            some_node_flags |= current_node_flags;
            all_node_flags &= current_node_flags;
            some_have_question_token |= self.is_optional_declaration(node);
            all_have_question_token &= self.is_optional_declaration(node);
            let body_is_present = has_body(&self.hir(node.0)[function]);
            if body_is_present && body_declaration.is_some() {
                if is_constructor {
                    multiple_constructor_implementation = true;
                } else {
                    duplicate_function_declaration = true;
                }
            } else if let Some(previous) = previous_declaration
                && self.parent_of_declaration(previous) == self.parent_of_declaration(node)
                && let Some(before) = files.loc_of_declaration(previous.0, previous.1)
                && let Some(loc) = files.loc_of_declaration(node.0, node.1)
                && before.end != loc.pos
                && let Some(it) = self.function_of_declaration(previous)
                && !self.hir(previous.0)[it].flags.contains(Flags::REPARSED)
            {
                self.report_implementation_expected_error(previous, is_constructor);
            }
            if !body_is_present {
                has_overloads = true;
            } else if body_declaration.is_none() {
                body_declaration = Some(node);
            }
            previous_declaration = Some(node);
            if !in_ambient_context_or_interface {
                last_seen_non_ambient_declaration = Some(node);
            }
        }
        for (is_reported, code) in [
            (multiple_constructor_implementation, 2392),
            (duplicate_function_declaration, 2393),
        ] {
            for &(declaration, _) in function_declarations.iter().filter(|_| is_reported) {
                self.error_at_declaration(declaration, code, &[]);
            }
        }
        if has_non_ambient_class && !is_constructor && flags.contains(SymFlags::FUNCTION) {
            let mut related_diagnostics: SmallVec<[Reported; 1]> = SmallVec::new();
            for &(file, decl) in declarations.iter() {
                if let Decl::Class(_) = decl
                    && let Some((start, end)) = self.error_range_of_declaration(file, decl)
                {
                    related_diagnostics.push(self.new_diagnostic((file, start, end), 6506, &[]));
                }
            }
            let name = Arg::Atom(files.symbol(symbol).name);
            for &declaration in declarations.iter() {
                let code = match declaration.1 {
                    Decl::Class(_) => 2813,
                    Decl::Fn(_) => 2814,
                    _ => continue,
                };
                if let Some(diagnostic) = self.error_at_declaration(declaration, code, &[name]) {
                    diagnostic.related_information = related_diagnostics.to_vec();
                }
            }
        }
        // "Abstract methods can't have an implementation -- in particular, they don't need one."
        if let Some(last) = last_seen_non_ambient_declaration
            && let Some(function) = self.function_of_declaration(last)
            && !has_body_node(&self.hir(last.0)[function])
            && !self.is_abstract_declaration(last)
            && !self.is_optional_declaration(last)
        {
            self.report_implementation_expected_error(last, is_constructor);
        }
        let Some(&first) = declarations.first().filter(|_| has_overloads) else {
            return;
        };
        // `checkFlagAgreementBetweenOverloads`: "Error if some overloads have a flag that is not shared by all overloads."
        if some_node_flags != all_node_flags {
            let canonical = self.get_canonical_overload(first, body_declaration);
            let canonical_flags = self.get_effective_declaration_flags(canonical, FLAGS_TO_CHECK);
            for &overload in declarations.iter() {
                // `overloadsInFile[0]`
                let first_in_file = declarations.iter().find(|it| it.0 == overload.0);
                let canonical = first_in_file.map_or(overload, |&it| {
                    self.get_canonical_overload(it, body_declaration)
                });
                let canonical_flags_for_file =
                    self.get_effective_declaration_flags(canonical, FLAGS_TO_CHECK);
                let own = self.get_effective_declaration_flags(overload, FLAGS_TO_CHECK);
                let (deviation, deviation_in_file) =
                    (own ^ canonical_flags, own ^ canonical_flags_for_file);
                let code = if deviation_in_file.contains(Flags::EXPORT) {
                    2383
                } else if deviation_in_file.contains(Flags::AMBIENT) {
                    2384
                } else if deviation.intersects(Flags::PRIVATE | Flags::PROTECTED) {
                    2385
                } else if deviation.contains(Flags::ABSTRACT) {
                    2512
                } else {
                    continue;
                };
                if code == 2385 {
                    self.error_at_declaration(overload, code, &[]);
                } else {
                    self.error_at_name_of_declaration(overload, code);
                }
            }
        }
        // `checkQuestionTokenAgreementBetweenOverloads`
        if some_have_question_token != all_have_question_token {
            let canonical = self.get_canonical_overload(first, body_declaration);
            let canonical_has_question_token = self.is_optional_declaration(canonical);
            for &overload in declarations.iter() {
                if self.is_optional_declaration(overload) != canonical_has_question_token {
                    self.error_at_name_of_declaration(overload, 2386);
                }
            }
        }
        let Some((body_declaration, implementation)) = function_declarations
            .iter()
            .find(|it| Some(it.0) == body_declaration)
            .copied()
        else {
            return;
        };
        let body_signature = self.sig_of_fn(body_declaration.0, implementation);
        for &(declaration, function) in &function_declarations {
            // `getSignaturesOfSymbol`: the implementation is not a signature.
            if has_body(&self.hir(declaration.0)[function]) {
                continue;
            }
            let signature = self.sig_of_fn(declaration.0, function);
            if !self.is_implementation_compatible_with_overload(body_signature, signature) {
                {
                    let (file, decl) = body_declaration;
                    let related = self.error_range_of_declaration(file, decl);
                    let related = related
                        .map(|(start, end)| self.new_diagnostic((file, start, end), 2750, &[]));
                    // `errorNode := signature.declaration`, not its name.
                    let (file, decl) = declaration;
                    if let Some((start, end)) = self.error_range_of_declaration(file, decl) {
                        let diagnostic = self.error_at((file, start, end), 2394, &[]);
                        diagnostic.related_information.extend(related);
                    }
                    break;
                }
            }
        }
    }

    /// `c.error(core.OrElse(ast.GetNameOfDeclaration(declaration), declaration), ..)`
    fn error_at_declaration(
        &mut self,
        (file, decl): Declaration,
        code: u32,
        args: &[Arg<'_>],
    ) -> Option<&mut Reported> {
        let (start, end) = match decl {
            // `GetErrorRangeForNode` spans the whole of a method signature.
            Decl::Member(m) if self.hir(file)[m].kind == MemberKind::Method => {
                (self.hir(file)[m].name_pos, self.end_of_member_name(file, m))
            }
            _ => self.error_range_of_declaration(file, decl)?,
        };
        Some(self.error_at((file, start, end), code, args))
    }

    /// `c.error(ast.GetNameOfDeclaration(declaration), ..)`. A constructor has no name, and an error
    /// at no node is in no file.
    fn error_at_name_of_declaration(&mut self, declaration: Declaration, code: u32) {
        match declaration.1 {
            Decl::Member(m) if self.hir(declaration.0)[m].kind == MemberKind::Constructor => {
                self.report_global_error(code, Vec::new());
            }
            _ => {
                self.error_at_declaration(declaration, code, &[]);
            }
        }
    }

    /// The `FnId` of a function declaration, a method, a method signature or a constructor.
    fn function_of_declaration(&self, (file, decl): Declaration) -> Option<FnId> {
        let hir = self.hir(file);
        match decl {
            Decl::Fn(f) if hir[f].kind == FnKind::Decl => Some(f),
            Decl::Member(m)
                if matches!(hir[m].kind, MemberKind::Method | MemberKind::Constructor) =>
            {
                hir[m].func.some()
            }
            _ => None,
        }
    }

    /// `node.Parent`, precise enough to tell whether two declarations have the same parent.
    fn parent_of_declaration(&self, (file, decl): Declaration) -> (FileId, Parent, MemberOwner) {
        let bound = self.bound(file);
        match (decl, self.files().statement_of_declaration(file, decl)) {
            (Decl::Member(m), _) => (file, Parent::None, bound.member_owner[m.idx()]),
            (_, Some(s)) => (file, bound.stmt_parent[s.idx()], MemberOwner::None),
            _ => (file, Parent::None, MemberOwner::None),
        }
    }

    /// `node.Flags&ast.NodeFlagsAmbient != 0`
    fn is_in_ambient_context(&self, (file, decl): Declaration) -> bool {
        let (hir, bound) = (self.hir(file), self.bound(file));
        hir.kind == FileKind::Declaration
            || match decl {
                // `parseClassElement`: its own `declare` makes a method ambient. Not so a constructor.
                Decl::Member(m) => {
                    hir[m].kind == MemberKind::Method && hir[m].flags.contains(Flags::AMBIENT)
                        || matches!(bound.member_owner[m.idx()], MemberOwner::Class(c)
                            if hir[c].flags.contains(Flags::AMBIENT))
                }
                // An import has no flags of its own.
                Decl::ImportDefault(_) | Decl::ImportNamespace(_) | Decl::ImportSpec(_) => {
                    let scope = bound
                        .scopes
                        .get(bound.scope_of_declaration(hir, decl).idx());
                    matches!(scope.map(|it| it.kind), Some(ScopeKind::Module(m))
                        if hir[m].flags.contains(Flags::AMBIENT) || !matches!(hir[m].name, ModuleName::Ident(_)))
                }
                _ => bound.modifier_flags(hir, decl).contains(Flags::AMBIENT),
            }
    }

    /// `isOptionalDeclaration`
    fn is_optional_declaration(&self, (file, decl): Declaration) -> bool {
        matches!(decl, Decl::Member(m) if self.hir(file)[m].flags.contains(Flags::OPTIONAL))
    }

    /// `ast.HasSyntacticModifier(node, ast.ModifierFlagsAbstract)`
    fn is_abstract_declaration(&self, (file, decl): Declaration) -> bool {
        matches!(decl, Decl::Member(m) if self.hir(file)[m].flags.contains(Flags::ABSTRACT))
    }

    /// `getCanonicalOverload`: "the implementation is the canonical signature only if it is in the same container as the first overload".
    fn get_canonical_overload(
        &self,
        first: Declaration,
        implementation: Option<Declaration>,
    ) -> Declaration {
        match implementation {
            Some(it) if self.parent_of_declaration(it) == self.parent_of_declaration(first) => it,
            _ => first,
        }
    }

    /// `getEffectiveDeclarationFlags`
    fn get_effective_declaration_flags(
        &self,
        declaration: Declaration,
        flags_to_check: Flags,
    ) -> Flags {
        let (file, decl) = declaration;
        let (hir, bound) = (self.hir(file), self.bound(file));
        // "children of classes (even ambient classes) should not be marked as ambient or export"
        if let Decl::Member(m) = decl {
            return hir[m].flags & flags_to_check & !(Flags::AMBIENT | Flags::EXPORT);
        }
        let mut flags = bound.modifier_flags(hir, decl) & !Flags::AMBIENT;
        if self.is_in_ambient_context(declaration) {
            let statement = match decl {
                Decl::Var(mut pat) => loop {
                    match bound.pat_parent[pat.idx()] {
                        PatParent::Prop(outer, _) | PatParent::Elem(outer, _) => pat = outer,
                        PatParent::Var(d) => break bound.var_stmt[d.idx()].some(),
                        _ => break None,
                    }
                },
                _ => self.files().statement_of_declaration(file, decl),
            };
            // `flags&ast.ModifierFlagsAmbient == 0`: it has no `declare` modifier of its own.
            let has_declare_keyword = statement.is_some_and(|s| {
                hir.find_modifier(hir[s].modifiers, Flags::AMBIENT)
                    .is_some()
            });
            // `ast.IsModuleBlock(n.Parent) && ast.IsGlobalScopeAugmentation(n.Parent.Parent)`
            let is_in_global_augmentation = !matches!(decl, Decl::Var(_))
                && statement.is_some_and(|s| {
                    matches!(bound.stmt_parent[s.idx()], Parent::Module(m) if hir[m].name == ModuleName::Global)
                });
            // `getEnclosingContainer`, which starts at `n.Parent`: the container the statement is
            // in, not the scope a namespace creates.
            let container = match statement {
                Some(s) => bound.stmt_scope[s.idx()],
                None => bound.scope_of_declaration(hir, decl),
            };
            if container.is_some()
                && bound.scopes[bound.container_scope(container).idx()].is_export_context
                && !has_declare_keyword
                && !is_in_global_augmentation
            {
                // "It is nested in an ambient export context, which means it is automatically exported"
                flags |= Flags::EXPORT;
            }
            flags |= Flags::AMBIENT;
        }
        flags & flags_to_check
    }

    /// `subsequentNode`, if it starts at the end of `node` and has the same kind as `node`.
    fn subsequent_declaration(&self, (file, decl): Declaration) -> Option<Decl> {
        let (hir, bound) = (self.hir(file), self.bound(file));
        if let Decl::Member(m) = decl {
            let next = MemberId(m.0 + 1);
            return (bound.member_owner.get(next.idx()) == Some(&bound.member_owner[m.idx()])
                && hir[next].loc.pos == hir[m].loc.end
                && hir[next].kind == hir[m].kind)
                .then_some(Decl::Member(next));
        }
        let s = self.files().statement_of_declaration(file, decl)?;
        let list = match bound.stmt_parent[s.idx()] {
            Parent::File => hir.body,
            Parent::Module(m) => hir[m].body,
            Parent::Case(case) => hir[case].body,
            Parent::FnBody(f) => match hir[f].body {
                FnBody::Block(list) => list,
                _ => return None,
            },
            Parent::Stmt(block) => match hir[block].kind {
                StmtKind::Block(list) => list,
                _ => return None,
            },
            _ => return None,
        };
        let next = hir.ids(list).skip_while(|&it| it != s).nth(1)?;
        match hir[next].kind {
            StmtKind::Fn(f) if hir[next].loc.pos == hir[s].loc.end => Some(Decl::Fn(f)),
            _ => None,
        }
    }

    /// `reportImplementationExpectedError`
    fn report_implementation_expected_error(&mut self, node: Declaration, is_constructor: bool) {
        let (file, decl) = node;
        let hir = self.hir(file);
        if self.is_declaration_name_missing(file, decl) {
            return;
        }
        // "We may be here because of some extra nodes between overloads that could not be parsed into a valid node. In this case the
        // subsequent node is not really consecutive (.pos !== node.end), and we must ignore it here."
        if let Some(subsequent) = self.subsequent_declaration(node) {
            let is_same_name = match (decl, subsequent) {
                (Decl::Fn(f), Decl::Fn(next)) => {
                    hir[f].name.is_some() && hir[next].name == hir[f].name
                }
                (Decl::Member(m), Decl::Member(next)) if !is_constructor => {
                    // "Both are computed property names", or neither is.
                    let is_computed = |m: MemberId| {
                        matches!(hir[m].key, PropKey::Computed(_))
                            || hir[m].flags.contains(Flags::COMPUTED_NAME)
                    };
                    let name = self.member_name(file, hir[m].key);
                    is_computed(m) == is_computed(next)
                        && name.is_some()
                        && self.member_name(file, hir[next].key) == name
                }
                _ => false,
            };
            if is_same_name {
                // "we can get here in two cases 1. mixed static and instance class members 2. something with the same name was defined
                // before the set of overloads that prevents them from merging. here we'll report error only for the first case since
                // for second we should already report error in binder"
                if let (Decl::Member(m), Decl::Member(next)) = (decl, subsequent)
                    && (hir[m].flags ^ hir[next].flags).contains(Flags::STATIC)
                {
                    let is_static = hir[m].flags.contains(Flags::STATIC);
                    let code = if is_static { 2387 } else { 2388 };
                    self.error_at_declaration((file, subsequent), code, &[]);
                }
                return;
            }
            if self
                .function_of_declaration((file, subsequent))
                .is_some_and(|next| has_body(&hir[next]))
            {
                // `DeclarationNameToString`
                let has_name = match decl {
                    Decl::Fn(f) => hir[f].name.is_some(),
                    _ => !is_constructor,
                };
                let name = self
                    .error_range_of_declaration(file, decl)
                    .filter(|_| has_name);
                let name = name.map_or(&b"(Missing)"[..], |(start, end)| {
                    &hir.text[start as usize..end as usize]
                });
                self.error_at_declaration((file, subsequent), 2389, &[Arg::Bytes(name)]);
                return;
            }
        }
        let code = if is_constructor {
            2390
        } else if self.is_abstract_declaration(node) {
            // "Report different errors regarding non-consecutive blocks of declarations depending on whether the node in question is
            // abstract."
            2516
        } else {
            2391
        };
        self.error_at_declaration(node, code, &[]);
    }

    /// `checkExportsOnMergedDeclarations` for the local symbol `symbol` of `file`, which has an
    /// `ExportSymbol`.
    fn check_exports_on_merged_declarations(&mut self, file: FileId, symbol: SymbolId) {
        let (hir, declarations) = (
            self.hir(file),
            &self.bound(file).symbols[symbol.idx()].decls,
        );
        // The declaration kinds that run this check: a class, an interface, an enum, a namespace, a
        // variable, a type alias. Not a function or an import.
        let asks = |decl: &Decl| {
            matches!(
                decl,
                Decl::Class(_)
                    | Decl::Interface(_)
                    | Decl::Enum(_)
                    | Decl::Module(_)
                    | Decl::Var(_)
                    | Decl::Alias(_)
            )
        };
        if !declarations.iter().any(asks) {
            return;
        }
        let symbol = self.files().sym(file, symbol);
        let (mut exported, mut non_exported, mut default_exported) = (0, 0, 0);
        for &d in declarations {
            let declaration_spaces = self.get_declaration_spaces(symbol, (file, d), 0);
            let flags =
                self.get_effective_declaration_flags((file, d), Flags::EXPORT | Flags::DEFAULT);
            if !flags.contains(Flags::EXPORT) {
                non_exported |= declaration_spaces;
            } else if flags.contains(Flags::DEFAULT) {
                default_exported |= declaration_spaces;
            } else {
                exported |= declaration_spaces;
            }
        }
        // "Spaces for anything not declared a 'default export'."
        let common_for_exports_and_locals = exported & non_exported;
        let common_for_default_and_non_default = default_exported & (exported | non_exported);
        // "Only error on the declarations that contributed to the intersecting spaces."
        for &d in declarations {
            let declaration_spaces = self.get_declaration_spaces(symbol, (file, d), 0);
            let code = if declaration_spaces & common_for_default_and_non_default != 0 {
                2652
            } else if declaration_spaces & common_for_exports_and_locals != 0 {
                2395
            } else {
                continue;
            };
            if let Some(at) = self.place_of_declaration(file, d) {
                let name = Arg::Bytes(&hir.text[at.1 as usize..at.2 as usize]);
                self.error_at(at, code, &[name]);
            }
        }
    }

    /// `getDeclarationSpaces` for a declaration of `symbol`.
    fn get_declaration_spaces(&self, symbol: Sym, (file, decl): Declaration, depth: u32) -> u8 {
        let (hir, files) = (self.hir(file), self.files());
        match decl {
            Decl::Interface(_) | Decl::Alias(_) | Decl::Member(_) => EXPORT_TYPE,
            Decl::Module(m)
                if matches!(hir[m].name, ModuleName::Ident(_))
                    && self.bound(file).module_instance_state[m.idx()]
                        == ModuleInstanceState::NonInstantiated =>
            {
                EXPORT_NAMESPACE
            }
            Decl::Module(_) => EXPORT_NAMESPACE | EXPORT_VALUE,
            Decl::Class(_) | Decl::Enum(_) | Decl::EnumMember(_) => EXPORT_TYPE | EXPORT_VALUE,
            Decl::File => EXPORT_TYPE | EXPORT_VALUE | EXPORT_NAMESPACE,
            Decl::Var(_) | Decl::Fn(_) | Decl::ImportSpec(_) => EXPORT_VALUE,
            // "Export assigned entity name expressions act as aliases and should fall through, otherwise they export values."
            Decl::ExportExpr(_) if !files.flags(symbol).contains(SymFlags::ALIAS) => EXPORT_VALUE,
            // "The below options all declare an Alias, which is allowed to merge with other values within the importing module."
            Decl::ExportExpr(_)
            | Decl::ImportDefault(_)
            | Decl::ImportNamespace(_)
            | Decl::ImportEquals(_)
                if depth < 8 =>
            {
                match files.resolve_alias(symbol).map(|it| files.canonical(it)) {
                    Some(target) if target != symbol => {
                        files.decls_of(target).iter().fold(0, |spaces, &d| {
                            spaces | self.get_declaration_spaces(target, d, depth + 1)
                        })
                    }
                    _ => 0,
                }
            }
            _ => 0,
        }
    }
}
