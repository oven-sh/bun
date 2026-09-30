// checker.go:3412-3791 (layer D-FUNC): function and method declarations, overload consistency, return paths.
use crate::ast::{
    Arg, Ast, DiagnosticId, FunctionFlags, Kind, ModifierFlags, NodeFlags, NodeId, SymbolFlags,
    SymbolId, get_function_flags, get_name_of_declaration, get_source_file_of_node,
    has_syntactic_modifier, is_block, is_class_declaration, is_class_expression, is_class_like,
    is_computed_property_name, is_constructor_declaration, is_function_declaration,
    is_global_scope_augmentation, is_interface_declaration, is_method_declaration,
    is_method_signature_declaration, is_module_block, is_private_identifier,
    is_property_name_literal, is_static, is_type_literal_node, node_is_missing, node_is_present,
};
use crate::checker::{
    Checker, RelationKind, SignatureId, TypeFlags, TypeId, WideningKind, get_enclosing_container,
    is_optional_declaration, is_private_within_ambient,
};
use crate::core::Tristate;
use crate::diagnostics::{self, MessageId};
use crate::scanner::declaration_name_to_string;

impl<'a> Checker<'a> {
    pub fn check_function_declaration(&mut self, node: NodeId) {
        self.check_function_or_method_declaration(node);
        self.check_grammar_for_generator(node);
        self.check_collisions_for_declaration_name(node, self.ast.name(node));
    }

    pub fn check_function_or_method_declaration(&mut self, node: NodeId) {
        let a = self.ast;
        self.check_decorators(node);
        self.check_signature_declaration(node);
        let function_flags = get_function_flags(a, node);
        // Do not use hasDynamicName here, because that returns false for well known symbols. We want to perform checkComputedPropertyName for all computed properties, including well known symbols.
        if !a.name(node).is_nil() && is_computed_property_name(a, a.name(node)) {
            // This check will account for methods in class/interface declarations, as well as accessors in classes/object literals
            self.check_computed_property_name(a.name(node));
        }
        if self.has_bindable_name(node) {
            // first we want to check the local symbol that contain this declaration: if node.localSymbol !== undefined the current declaration is exported and localSymbol points to the local symbol, if node.localSymbol === undefined this node is non-exported so we can just pick the result of getSymbolOfNode
            let symbol = self.get_symbol_of_declaration(node);
            let mut local_symbol = a.local_symbol(node);
            if local_symbol.is_nil() {
                local_symbol = symbol;
            }
            // Since the javascript won't do semantic analysis like typescript, ignore javascript function declarations so that redeclaring a function in a JS file is not reported as a duplicate.
            if !a.flags(node).intersects(NodeFlags::JAVA_SCRIPT_FILE) {
                self.check_function_or_constructor_symbol(local_symbol);
            }
            if !a.sym(symbol).parent.is_nil() {
                // run check on export symbol to check that modifiers agree across all exported declarations
                self.check_function_or_constructor_symbol(symbol);
            }
        }
        let body = a.body(node);
        self.check_source_element(body);
        let return_type = self.get_return_type_from_annotation(node);
        self.check_all_code_paths_in_non_void_function_return_or_throw(node, return_type);
        let full_signature = a
            .function_like_data(node)
            .map_or(NodeId::NIL, |data| data.full_signature);
        if !full_signature.is_nil() {
            let full_signature_type = self.get_type_from_type_node(full_signature);
            if self
                .get_contextual_call_signature(full_signature_type, node)
                .is_nil()
            {
                self.error(full_signature, diagnostics::A_JSDOC_TYPE_TAG_ON_A_FUNCTION_MUST_HAVE_A_SIGNATURE_WITH_THE_CORRECT_NUMBER_OF_ARGUMENTS, &[]);
            }
        }
        if a.type_node(node).is_nil() {
            // Report an implicit any error if there is no body, no explicit return type, and node is not a private method in an ambient context
            if node_is_missing(a, body) && !is_private_within_ambient(a, node) {
                self.report_implicit_any(node, self.any_type, WideningKind::NORMAL);
            }
            if function_flags.intersects(FunctionFlags::GENERATOR) && node_is_present(a, body) {
                // A generator with a body and no type annotation can still cause errors. It can error if the yielded values have no common supertype, or it can give an implicit any error if it has no yielded values. The only way to trigger these errors is to try checking its return type.
                let signature = self.get_signature_from_declaration(node);
                self.get_return_type_of_signature(signature);
            }
        }
    }

    pub fn check_function_or_constructor_symbol(&mut self, symbol: SymbolId) {
        // Only check the symbol once
        let links = self.value_symbol_links_get(symbol);
        if !self.value_symbol_links[links].function_or_constructor_checked {
            self.value_symbol_links[links].function_or_constructor_checked = true;
            self.check_function_or_constructor_symbol_worker(symbol);
        }
    }

    pub fn check_function_or_constructor_symbol_worker(&mut self, symbol: SymbolId) {
        // The closure getCanonicalOverload of upstream.
        fn get_canonical_overload(
            a: Ast<'_>,
            overloads: &[NodeId],
            implementation: NodeId,
        ) -> NodeId {
            // Consider the canonical set of flags to be the flags of the bodyDeclaration or the first declaration. Error on all deviations from this canonical set of flags. The caveat is that if some overloads are defined in lib.d.ts, we don't want to report the errors on those. To achieve this, we will say that the implementation is the canonical signature only if it is in the same container as the first overload
            let first_overload = overloads.first().copied().unwrap_or_default();
            let implementation_shares_container_with_first_overload =
                !implementation.is_nil() && a.parent(implementation) == a.parent(first_overload);
            if implementation_shares_container_with_first_overload {
                return implementation;
            }
            first_overload
        }

        // The closure checkFlagAgreementBetweenOverloads of upstream.
        fn check_flag_agreement_between_overloads(
            c: &mut Checker<'_>,
            overloads: &[NodeId],
            implementation: NodeId,
            flags_to_check: ModifierFlags,
            some_overload_flags: ModifierFlags,
            all_overload_flags: ModifierFlags,
        ) {
            let a = c.ast;
            // Error if some overloads have a flag that is not shared by all overloads. To find the deviations, we XOR someOverloadFlags with allOverloadFlags
            let some_but_not_all_overload_flags =
                ModifierFlags(some_overload_flags.0 ^ all_overload_flags.0);
            if some_but_not_all_overload_flags != ModifierFlags::NONE {
                let canonical_flags = c.get_effective_declaration_flags(
                    get_canonical_overload(a, overloads, implementation),
                    flags_to_check,
                );
                // Upstream groups the overloads by file in a map and ranges over it: the groups are kept in the order of their first overload.
                let mut groups: Vec<(NodeId, Vec<NodeId>)> = Vec::new();
                for &overload in overloads {
                    let source_file = get_source_file_of_node(a, overload);
                    match groups.iter_mut().find(|group| group.0 == source_file) {
                        Some(group) => group.1.push(overload),
                        None => groups.push((source_file, vec![overload])),
                    }
                }
                for (_, overloads_in_file) in &groups {
                    let canonical_flags_for_file = c.get_effective_declaration_flags(
                        get_canonical_overload(a, overloads_in_file, implementation),
                        flags_to_check,
                    );
                    for &overload in overloads_in_file {
                        let deviation = ModifierFlags(
                            c.get_effective_declaration_flags(overload, flags_to_check)
                                .0
                                ^ canonical_flags.0,
                        );
                        let deviation_in_file = ModifierFlags(
                            c.get_effective_declaration_flags(overload, flags_to_check)
                                .0
                                ^ canonical_flags_for_file.0,
                        );
                        if deviation_in_file.intersects(ModifierFlags::EXPORT) {
                            // Overloads in different files need not all have export modifiers: `declare function foo(s: number): string; declare function foo(s: string): number; export { foo };` in lib.d.ts and `declare module "lib" { export function foo(s: boolean): boolean; }` in app.ts is ok.
                            c.error(
                                get_name_of_declaration(a, overload),
                                diagnostics::OVERLOAD_SIGNATURES_MUST_ALL_BE_EXPORTED_OR_NON_EXPORTED,
                                &[],
                            );
                        } else if deviation_in_file.intersects(ModifierFlags::AMBIENT) {
                            // Though rare, a module augmentation (necessarily ambient) is allowed to add overloads to a non-ambient function in an implementation file.
                            c.error(
                                get_name_of_declaration(a, overload),
                                diagnostics::OVERLOAD_SIGNATURES_MUST_ALL_BE_AMBIENT_OR_NON_AMBIENT,
                                &[],
                            );
                        } else if deviation
                            .intersects(ModifierFlags::PRIVATE | ModifierFlags::PROTECTED)
                        {
                            let mut error_node = get_name_of_declaration(a, overload);
                            if error_node.is_nil() {
                                error_node = overload;
                            }
                            c.error(
                                error_node,
                                diagnostics::OVERLOAD_SIGNATURES_MUST_ALL_BE_PUBLIC_PRIVATE_OR_PROTECTED,
                                &[],
                            );
                        } else if deviation.intersects(ModifierFlags::ABSTRACT) {
                            c.error(
                                get_name_of_declaration(a, overload),
                                diagnostics::OVERLOAD_SIGNATURES_MUST_ALL_BE_ABSTRACT_OR_NON_ABSTRACT,
                                &[],
                            );
                        }
                    }
                }
            }
        }

        // The closure checkQuestionTokenAgreementBetweenOverloads of upstream.
        fn check_question_token_agreement_between_overloads(
            c: &mut Checker<'_>,
            overloads: &[NodeId],
            implementation: NodeId,
            some_have_question_token: bool,
            all_have_question_token: bool,
        ) {
            let a = c.ast;
            if some_have_question_token != all_have_question_token {
                let canonical_has_question_token = is_optional_declaration(
                    a,
                    get_canonical_overload(a, overloads, implementation),
                );
                for &o in overloads {
                    if is_optional_declaration(a, o) != canonical_has_question_token {
                        c.error(
                            get_name_of_declaration(a, o),
                            diagnostics::OVERLOAD_SIGNATURES_MUST_ALL_BE_OPTIONAL_OR_REQUIRED,
                            &[],
                        );
                    }
                }
            }
        }

        // The closure reportImplementationExpectedError of upstream.
        fn report_implementation_expected_error(
            c: &mut Checker<'_>,
            is_constructor: bool,
            node: NodeId,
        ) {
            let a = c.ast;
            let name = a.name(node);
            if !name.is_nil() && node_is_missing(a, name) {
                return;
            }
            let mut seen = false;
            let mut subsequent_node = NodeId::NIL;
            a.for_each_child(a.parent(node), &mut |child| {
                if seen {
                    subsequent_node = child;
                    return true;
                }
                seen = child == node;
                false
            });
            // We may be here because of some extra nodes between overloads that could not be parsed into a valid node. In this case the subsequent node is not really consecutive (.pos !== node.end), and we must ignore it here.
            if !subsequent_node.is_nil() && a.pos(subsequent_node) == a.end(node) {
                if a.kind(subsequent_node) == a.kind(node) {
                    let subsequent_name = a.name(subsequent_node);
                    let error_node = if subsequent_name.is_nil() {
                        subsequent_node
                    } else {
                        subsequent_name
                    };
                    let mut names_match = false;
                    if !name.is_nil() && !subsequent_name.is_nil() {
                        if is_private_identifier(a, name)
                            && is_private_identifier(a, subsequent_name)
                            && a.text(name) == a.text(subsequent_name)
                        {
                            names_match = true;
                        } else if is_computed_property_name(a, name)
                            && is_computed_property_name(a, subsequent_name)
                        {
                            let name_type = c.check_computed_property_name(name);
                            let subsequent_name_type =
                                c.check_computed_property_name(subsequent_name);
                            names_match = c.is_type_identical_to(name_type, subsequent_name_type);
                        }
                        if !names_match
                            && is_property_name_literal(a, name)
                            && is_property_name_literal(a, subsequent_name)
                            && a.text(name) == a.text(subsequent_name)
                        {
                            names_match = true;
                        }
                    }
                    if names_match {
                        let report_error = (is_method_declaration(a, node)
                            || is_method_signature_declaration(a, node))
                            && is_static(a, node) != is_static(a, subsequent_node);
                        // we can get here in two cases: 1. mixed static and instance class members, 2. something with the same name was defined before the set of overloads that prevents them from merging. Here we'll report error only for the first case since for second we should already report error in binder
                        if report_error {
                            let diagnostic = if is_static(a, node) {
                                diagnostics::FUNCTION_OVERLOAD_MUST_BE_STATIC
                            } else {
                                diagnostics::FUNCTION_OVERLOAD_MUST_NOT_BE_STATIC
                            };
                            c.error(error_node, diagnostic, &[]);
                        }
                        return;
                    }
                    if node_is_present(a, a.body(subsequent_node)) {
                        let name_text = declaration_name_to_string(a, name);
                        c.error(
                            error_node,
                            diagnostics::FUNCTION_IMPLEMENTATION_NAME_MUST_BE_0,
                            &[Arg::Str(&name_text)],
                        );
                        return;
                    }
                }
            }
            let error_node = if name.is_nil() { node } else { name };
            if is_constructor {
                c.error(
                    error_node,
                    diagnostics::CONSTRUCTOR_IMPLEMENTATION_IS_MISSING,
                    &[],
                );
            } else {
                // Report different errors regarding non-consecutive blocks of declarations depending on whether the node in question is abstract.
                if has_syntactic_modifier(a, node, ModifierFlags::ABSTRACT) {
                    c.error(
                        error_node,
                        diagnostics::ALL_DECLARATIONS_OF_AN_ABSTRACT_METHOD_MUST_BE_CONSECUTIVE,
                        &[],
                    );
                } else {
                    c.error(error_node, diagnostics::FUNCTION_IMPLEMENTATION_IS_MISSING_OR_NOT_IMMEDIATELY_FOLLOWING_THE_DECLARATION, &[]);
                }
            }
        }

        let a = self.ast;
        let flags_to_check = ModifierFlags::EXPORT
            | ModifierFlags::AMBIENT
            | ModifierFlags::PRIVATE
            | ModifierFlags::PROTECTED
            | ModifierFlags::ABSTRACT;
        let mut some_node_flags = ModifierFlags::NONE;
        let mut all_node_flags = flags_to_check;
        let mut some_have_question_token = false;
        let mut all_have_question_token = true;
        let mut has_overloads = false;
        let mut body_declaration = NodeId::NIL;
        let mut last_seen_non_ambient_declaration = NodeId::NIL;
        let mut previous_declaration = NodeId::NIL;
        let symbol_data = a.sym(symbol);
        let declarations = symbol_data.declarations;
        let is_constructor = symbol_data.flags.intersects(SymbolFlags::CONSTRUCTOR);
        let mut duplicate_function_declaration = false;
        let mut multiple_constructor_implementation = false;
        let mut has_non_ambient_class = false;
        let mut function_declarations: Vec<NodeId> = Vec::new();
        for &node in declarations.as_slice() {
            let in_ambient_context = a.flags(node).intersects(NodeFlags::AMBIENT);
            let in_ambient_context_or_interface = in_ambient_context
                || !a.parent(node).is_nil()
                    && (is_interface_declaration(a, a.parent(node))
                        || is_type_literal_node(a, a.parent(node)));
            if in_ambient_context_or_interface {
                // check if declarations are consecutive only if they are non-ambient: 1. ambient declarations can be interleaved, i.e. `declare function foo(); declare function bar(); declare function foo();` is legal, 2. mixing ambient and non-ambient declarations is a separate error that will be reported - do not want to report an extra one
                previous_declaration = NodeId::NIL;
            }
            if is_class_like(a, node) && !in_ambient_context {
                has_non_ambient_class = true;
            }
            if is_function_declaration(a, node)
                || is_method_declaration(a, node)
                || is_method_signature_declaration(a, node)
                || is_constructor_declaration(a, node)
            {
                function_declarations.push(node);
                let current_node_flags = self.get_effective_declaration_flags(node, flags_to_check);
                some_node_flags |= current_node_flags;
                all_node_flags = all_node_flags & current_node_flags;
                some_have_question_token =
                    some_have_question_token || is_optional_declaration(a, node);
                all_have_question_token =
                    all_have_question_token && is_optional_declaration(a, node);
                let body_is_present = node_is_present(a, a.body(node));
                if body_is_present && !body_declaration.is_nil() {
                    if is_constructor {
                        multiple_constructor_implementation = true;
                    } else {
                        duplicate_function_declaration = true;
                    }
                } else if !previous_declaration.is_nil()
                    && a.parent(previous_declaration) == a.parent(node)
                    && a.end(previous_declaration) != a.pos(node)
                    && !a
                        .flags(previous_declaration)
                        .intersects(NodeFlags::REPARSED)
                {
                    report_implementation_expected_error(
                        self,
                        is_constructor,
                        previous_declaration,
                    );
                }
                if body_is_present {
                    if body_declaration.is_nil() {
                        body_declaration = node;
                    }
                } else {
                    has_overloads = true;
                }
                previous_declaration = node;
                if !in_ambient_context_or_interface {
                    last_seen_non_ambient_declaration = node;
                }
            }
        }
        if multiple_constructor_implementation {
            for &declaration in &function_declarations {
                self.error(
                    declaration,
                    diagnostics::MULTIPLE_CONSTRUCTOR_IMPLEMENTATIONS_ARE_NOT_ALLOWED,
                    &[],
                );
            }
        }
        if duplicate_function_declaration {
            for &declaration in &function_declarations {
                let mut error_node = get_name_of_declaration(a, declaration);
                if error_node.is_nil() {
                    error_node = declaration;
                }
                self.error(
                    error_node,
                    diagnostics::DUPLICATE_FUNCTION_IMPLEMENTATION,
                    &[],
                );
            }
        }
        if has_non_ambient_class
            && !is_constructor
            && symbol_data.flags.intersects(SymbolFlags::FUNCTION)
            && declarations.len() != 0
        {
            let mut related_diagnostics: Vec<DiagnosticId> = Vec::new();
            for &declaration in declarations.as_slice() {
                if is_class_declaration(a, declaration) {
                    let related = self.create_diagnostic_for_node(
                        declaration,
                        diagnostics::CONSIDER_ADDING_A_DECLARE_MODIFIER_TO_THIS_CLASS,
                        &[],
                    );
                    related_diagnostics.push(related);
                }
            }
            for &declaration in declarations.as_slice() {
                let diagnostic = match a.kind(declaration) {
                    Kind::ClassDeclaration => {
                        diagnostics::CLASS_DECLARATION_CANNOT_IMPLEMENT_OVERLOAD_LIST_FOR_0
                    }
                    Kind::FunctionDeclaration => {
                        diagnostics::FUNCTION_WITH_BODIES_CAN_ONLY_MERGE_WITH_CLASSES_THAT_ARE_AMBIENT
                    }
                    _ => MessageId::NIL,
                };
                if !diagnostic.is_nil() {
                    let mut error_node = get_name_of_declaration(a, declaration);
                    if error_node.is_nil() {
                        error_node = declaration;
                    }
                    let error = self.error(error_node, diagnostic, &[Arg::Str(symbol_data.name)]);
                    self.diagnostic_store
                        .set_related_info(error, related_diagnostics.clone());
                }
            }
        }
        // Abstract methods can't have an implementation -- in particular, they don't need one.
        if !last_seen_non_ambient_declaration.is_nil()
            && a.body(last_seen_non_ambient_declaration).is_nil()
            && !has_syntactic_modifier(
                a,
                last_seen_non_ambient_declaration,
                ModifierFlags::ABSTRACT,
            )
            && !is_optional_declaration(a, last_seen_non_ambient_declaration)
        {
            report_implementation_expected_error(
                self,
                is_constructor,
                last_seen_non_ambient_declaration,
            );
        }
        if has_overloads {
            check_flag_agreement_between_overloads(
                self,
                declarations.as_slice(),
                body_declaration,
                flags_to_check,
                some_node_flags,
                all_node_flags,
            );
            check_question_token_agreement_between_overloads(
                self,
                declarations.as_slice(),
                body_declaration,
                some_have_question_token,
                all_have_question_token,
            );
            if !body_declaration.is_nil() {
                let signatures = self.get_signatures_of_symbol(symbol);
                let body_signature = self.get_signature_from_declaration(body_declaration);
                for &signature in signatures.as_slice() {
                    if !self.is_implementation_compatible_with_overload(body_signature, signature) {
                        let error_node = self.signatures[signature].declaration;
                        let error = self.error(error_node, diagnostics::THIS_OVERLOAD_SIGNATURE_IS_NOT_COMPATIBLE_WITH_ITS_IMPLEMENTATION_SIGNATURE, &[]);
                        let related = self.create_diagnostic_for_node(
                            body_declaration,
                            diagnostics::THE_IMPLEMENTATION_SIGNATURE_IS_DECLARED_HERE,
                            &[],
                        );
                        self.diagnostic_store.add_related_info(error, related);
                        break;
                    }
                }
            }
        }
    }

    pub fn get_effective_declaration_flags(
        &mut self,
        n: NodeId,
        flags_to_check: ModifierFlags,
    ) -> ModifierFlags {
        let a = self.ast;
        let mut flags = self.get_combined_modifier_flags_cached(n);
        // children of classes (even ambient classes) should not be marked as ambient or export because those flags have no useful semantics there.
        let parent = a.parent(n);
        if !is_interface_declaration(a, parent)
            && !is_class_declaration(a, parent)
            && !is_class_expression(a, parent)
            && a.flags(n).intersects(NodeFlags::AMBIENT)
        {
            let container = get_enclosing_container(a, n);
            if !container.is_nil()
                && a.flags(container).intersects(NodeFlags::EXPORT_CONTEXT)
                && !flags.intersects(ModifierFlags::AMBIENT)
                && !(is_module_block(a, parent)
                    && is_global_scope_augmentation(a, a.parent(parent)))
            {
                // It is nested in an ambient export context, which means it is automatically exported
                flags |= ModifierFlags::EXPORT;
            }
            flags |= ModifierFlags::AMBIENT;
        }
        flags & flags_to_check
    }

    pub fn is_implementation_compatible_with_overload(
        &mut self,
        implementation: SignatureId,
        overload: SignatureId,
    ) -> bool {
        let erased_source = self.get_erased_signature(implementation);
        let erased_target = self.get_erased_signature(overload);
        // First see if the return types are compatible in either direction.
        let source_return_type = self.get_return_type_of_signature(erased_source);
        let target_return_type = self.get_return_type_of_signature(erased_target);
        if target_return_type == self.void_type
            || self.is_type_related_to(
                target_return_type,
                source_return_type,
                RelationKind::Assignable,
            )
            || self.is_type_related_to(
                source_return_type,
                target_return_type,
                RelationKind::Assignable,
            )
        {
            return self.is_signature_assignable_to(erased_source, erased_target, true);
        }
        false
    }

    pub fn check_all_code_paths_in_non_void_function_return_or_throw(
        &mut self,
        func: NodeId,
        return_type: TypeId,
    ) {
        let a = self.ast;
        let function_flags = get_function_flags(a, func);
        let mut t = TypeId::NIL;
        if !return_type.is_nil() {
            t = self.unwrap_return_type(return_type, function_flags);
        }
        // Functions with an explicitly specified return type that includes `void` or is exactly `any` or `undefined` don't need any return statements.
        if !t.is_nil()
            && (self.maybe_type_of_kind(t, TypeFlags::VOID)
                || self.types[t]
                    .flags
                    .intersects(TypeFlags::ANY | TypeFlags::UNDEFINED))
        {
            return;
        }
        // If all we have is a function signature, or an arrow function with an expression body, then there is nothing to check. Also if HasImplicitReturn flag is not set this means that all codepaths in function body end with return or throw
        if is_method_signature_declaration(a, func)
            || node_is_missing(a, a.body(func))
            || !is_block(a, a.body(func))
            || !self.function_has_implicit_return(func)
        {
            return;
        }
        let has_explicit_return = a.flags(func).intersects(NodeFlags::HAS_EXPLICIT_RETURN);
        let mut error_node = a.type_node(func);
        if error_node.is_nil() {
            if let Some(data) = a.function_like_data(func) {
                if !data.full_signature.is_nil() {
                    error_node = data.full_signature;
                }
            }
        }
        if error_node.is_nil() {
            error_node = func;
        }
        if !t.is_nil() && self.types[t].flags.intersects(TypeFlags::NEVER) {
            self.error(
                error_node,
                diagnostics::A_FUNCTION_RETURNING_NEVER_CANNOT_HAVE_A_REACHABLE_END_POINT,
                &[],
            );
        } else if !t.is_nil() && !has_explicit_return {
            // minimal check: function has syntactic return type annotation and no explicit return statements in the body, this function does not conform to the specification.
            self.error(error_node, diagnostics::A_FUNCTION_WHOSE_DECLARED_TYPE_IS_NEITHER_UNDEFINED_VOID_NOR_ANY_MUST_RETURN_A_VALUE, &[]);
        } else if !t.is_nil()
            && self.strict_null_checks
            && !self.is_type_assignable_to(self.undefined_type, t)
        {
            self.error(error_node, diagnostics::FUNCTION_LACKS_ENDING_RETURN_STATEMENT_AND_RETURN_TYPE_DOES_NOT_INCLUDE_UNDEFINED, &[]);
        } else if self.compiler_options.no_implicit_returns == Tristate::TRUE {
            if t.is_nil() {
                // If return type annotation is omitted check if function has any explicit return statements. If it does not have any - its inferred return type is void - don't do any checks. Otherwise get inferred return type from function body and report error only if it is not void / anytype
                if !has_explicit_return {
                    return;
                }
                let signature = self.get_signature_from_declaration(func);
                let inferred_return_type = self.get_return_type_of_signature(signature);
                if self.is_unwrapped_return_type_undefined_void_or_any(func, inferred_return_type) {
                    return;
                }
            }
            self.error(
                error_node,
                diagnostics::NOT_ALL_CODE_PATHS_RETURN_A_VALUE,
                &[],
            );
        }
    }

    pub fn is_unwrapped_return_type_undefined_void_or_any(
        &mut self,
        func: NodeId,
        return_type: TypeId,
    ) -> bool {
        let t = self.unwrap_return_type(return_type, get_function_flags(self.ast, func));
        !t.is_nil()
            && (self.maybe_type_of_kind(t, TypeFlags::VOID)
                || self.types[t]
                    .flags
                    .intersects(TypeFlags::ANY | TypeFlags::UNDEFINED))
    }
}
