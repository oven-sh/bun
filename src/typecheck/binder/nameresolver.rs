// Port of internal/binder/nameresolver.go of typescript-go 89d5d5b.
use crate::ast::{
    self, Arg, Ast, DiagnosticId, Kind, ModifierFlags, NodeFlags, NodeId, SymbolFlags, SymbolId,
    SymbolTableId,
};
use crate::core::{self, CompilerOptions, ScriptTarget, Tristate};
use crate::diagnostics::{self, MessageId};
use crate::internal::FaultKind;
use bun_core::StackCheck;

// A function-valued field of upstream is a function pointer that takes its host first: the checker passes its own methods, and a nil field is `None`.
pub struct NameResolver<'o, H> {
    pub compiler_options: &'o CompilerOptions,
    pub get_symbol_of_declaration: Option<fn(&mut H, NodeId) -> SymbolId>,
    pub error: Option<fn(&mut H, NodeId, MessageId, &[Arg<'_>]) -> DiagnosticId>,
    pub globals: SymbolTableId,
    pub arguments_symbol: SymbolId,
    pub require_symbol: SymbolId,
    pub lookup: Option<fn(&mut H, SymbolTableId, &[u8], SymbolFlags) -> SymbolId>,
    pub symbol_referenced: Option<fn(&mut H, SymbolId, SymbolFlags)>,
    pub set_requires_scope_change_cache: Option<fn(&mut H, NodeId, Tristate)>,
    pub get_requires_scope_change_cache: Option<fn(&mut H, NodeId) -> Tristate>,
    pub on_property_with_invalid_initializer:
        Option<fn(&mut H, NodeId, &[u8], NodeId, SymbolId) -> bool>,
    pub on_failed_to_resolve_symbol: Option<fn(&mut H, NodeId, &[u8], SymbolFlags, MessageId)>,
    pub on_successfully_resolved_symbol:
        Option<fn(&mut H, NodeId, SymbolId, SymbolFlags, NodeId, NodeId, bool)>,
}

impl<H> NameResolver<'_, H> {
    pub fn resolve(
        &mut self,
        a: Ast<'_>,
        host: &mut H,
        location: NodeId,
        name: &[u8],
        meaning: SymbolFlags,
        name_not_found_message: MessageId,
        is_use: bool,
        exclude_globals: bool,
    ) -> SymbolId {
        let mut location = location;
        let mut result = SymbolId::NIL;
        let mut last_location = NodeId::NIL;
        let mut last_self_reference_location = NodeId::NIL;
        let mut property_with_invalid_initializer = NodeId::NIL;
        let mut associated_declaration_for_containing_initializer_or_binding_name = NodeId::NIL;
        let mut within_deferred_context = false;
        // needed for did-you-mean error reporting, which gathers candidates starting from the original location
        let original_location = location;
        let name_is_const = name == b"const";
        'resolve: while !location.is_nil() {
            if name_is_const && ast::is_const_assertion(a, location) {
                // `const` in an `as const` has no symbol, but issues no error because there is no *actual* lookup of the type (it refers to the constant type of the expression instead)
                return SymbolId::NIL;
            }
            if ast::is_module_or_enum_declaration(a, location)
                && !last_location.is_nil()
                && a.name(location) == last_location
            {
                // If lastLocation is the name of a namespace or enum, skip the parent since it will have is own locals that could conflict.
                last_location = location;
                location = a.parent(location);
            }
            let locals = a.locals(location);
            // Locals of a source file are not in scope (because they get merged into the global symbol table)
            if !locals.is_nil() && !ast::is_global_source_file(a, location) {
                result = self.lookup(a, host, locals, name, meaning);
                if !result.is_nil() {
                    let mut use_result = true;
                    if ast::is_function_like(a, location)
                        && !last_location.is_nil()
                        && last_location != a.body(location)
                    {
                        // symbol lookup restrictions for function-like declarations: type parameters of a function are in scope in the entire function declaration, including the parameter list and return type. However, local types are only in scope in the function body. Parameters are only in the scope of function body. This restriction does not apply to JSDoc comment types because they are parented at a higher level than type parameters would normally be
                        if (meaning & a.sym(result).flags).intersects(SymbolFlags::TYPE)
                            && a.kind(last_location) != Kind::JSDoc
                        {
                            // type parameters are visible in parameter list, return type and type parameter list. Synthetic fake scopes are added for signatures so type parameters are accessible from them.
                            use_result =
                                a.sym(result).flags.intersects(SymbolFlags::TYPE_PARAMETER)
                                    && (a.flags(last_location).intersects(NodeFlags::SYNTHESIZED)
                                        || last_location == a.type_node(location)
                                        || a.kind(last_location) == Kind::Parameter
                                        || a.kind(last_location) == Kind::JSDocParameterTag
                                        || a.kind(last_location) == Kind::JSDocReturnTag
                                        || a.kind(last_location) == Kind::TypeParameter);
                        }
                        if (meaning & a.sym(result).flags).intersects(SymbolFlags::VARIABLE) {
                            // expression inside parameter will lookup as normal variable scope when targeting es2015+
                            if self.use_outer_variable_scope_in_parameter(
                                a,
                                host,
                                result,
                                location,
                                last_location,
                            ) {
                                use_result = false;
                            } else if a
                                .sym(result)
                                .flags
                                .intersects(SymbolFlags::FUNCTION_SCOPED_VARIABLE)
                            {
                                // parameters are visible only inside function body, parameter list and return type. Technically for parameter list case here we might mix parameters and variables declared in function, however it is detected separately when checking initializers of parameters to make sure that they reference no variables declared after them.
                                use_result = a.kind(last_location) == Kind::Parameter
                                    || a.flags(last_location).intersects(NodeFlags::SYNTHESIZED)
                                    || (last_location == a.type_node(location)
                                        && !ast::find_ancestor(
                                            a,
                                            a.sym(result).value_declaration,
                                            |n| ast::is_parameter_declaration(a, n),
                                        )
                                        .is_nil());
                            }
                        }
                    } else if a.kind(location) == Kind::ConditionalType {
                        // A type parameter declared using 'infer T' in a conditional type is visible only in the true branch of the conditional type.
                        use_result =
                            last_location == a.as_conditional_type_node(location).true_type;
                    }
                    if use_result {
                        break 'resolve;
                    }
                    result = SymbolId::NIL;
                }
            }
            within_deferred_context =
                within_deferred_context || get_is_deferred_context(a, location, last_location);
            'switch: {
                match a.kind(location) {
                    Kind::SourceFile | Kind::ModuleDeclaration => {
                        if a.kind(location) == Kind::SourceFile
                            && !ast::is_external_or_common_js_module(a, location)
                        {
                            break 'switch;
                        }
                        let module_symbol = self.get_symbol_of_declaration(a, host, location);
                        if module_symbol.is_nil() {
                            break 'switch;
                        }
                        let module_exports = a.sym(module_symbol).exports;
                        if ast::is_source_file(a, location)
                            || (ast::is_module_declaration(a, location)
                                && a.flags(location).intersects(NodeFlags::AMBIENT)
                                && !ast::is_global_scope_augmentation(a, location))
                        {
                            // It's an external module. First see if the module has an export default and if the local name of that export default matches.
                            result = a.table_get(module_exports, ast::INTERNAL_SYMBOL_NAME_DEFAULT);
                            if !result.is_nil() {
                                let local_symbol = get_local_symbol_for_export_default(a, result);
                                if !local_symbol.is_nil()
                                    && a.sym(result).flags.intersects(meaning)
                                    && a.sym(local_symbol).name == name
                                {
                                    break 'resolve;
                                }
                                result = SymbolId::NIL;
                            }
                            // Because of module/namespace merging, a module's exports are in scope, yet we never want to treat an export specifier as putting a member in scope. Therefore, if the name we find is purely an export specifier, it is not actually considered in scope. Two things to note about this: 1. We have to check this without calling getSymbol. The problem with calling getSymbol on an export specifier is that it might find the export specifier itself, and try to resolve it as an alias. This will cause the checker to consider the export specifier a circular alias reference when it might not be. 2. We check === SymbolFlags.Alias in order to check that the symbol is *purely* an alias. If we used &, we'd be throwing out symbols that have non alias aspects, which is not the desired behavior.
                            let module_export = a.table_get(module_exports, name);
                            if !module_export.is_nil()
                                && a.sym(module_export).flags == SymbolFlags::ALIAS
                                && (!ast::get_declaration_of_kind(
                                    a,
                                    module_export,
                                    Kind::ExportSpecifier,
                                )
                                .is_nil()
                                    || !ast::get_declaration_of_kind(
                                        a,
                                        module_export,
                                        Kind::NamespaceExport,
                                    )
                                    .is_nil())
                            {
                                break 'switch;
                            }
                        }
                        if name != ast::INTERNAL_SYMBOL_NAME_DEFAULT {
                            result = self.lookup(
                                a,
                                host,
                                module_exports,
                                name,
                                meaning & SymbolFlags::MODULE_MEMBER,
                            );
                            if !result.is_nil() {
                                if ast::is_source_file(a, location)
                                    && !a
                                        .as_source_file(location)
                                        .common_js_module_indicator
                                        .is_nil()
                                    && !a.sym(result).flags.intersects(SymbolFlags::TYPE)
                                {
                                    result = SymbolId::NIL;
                                } else {
                                    break 'resolve;
                                }
                            }
                        }
                    }
                    Kind::EnumDeclaration => {
                        let enum_symbol = self.get_symbol_of_declaration(a, host, location);
                        if enum_symbol.is_nil() {
                            break 'switch;
                        }
                        result = self.lookup(
                            a,
                            host,
                            a.sym(enum_symbol).exports,
                            name,
                            meaning & SymbolFlags::ENUM_MEMBER,
                        );
                        if !result.is_nil() {
                            if !name_not_found_message.is_nil()
                                && self.compiler_options.get_isolated_modules()
                                && !a.flags(location).intersects(NodeFlags::AMBIENT)
                                && ast::get_source_file_of_node(a, location)
                                    != ast::get_source_file_of_node(
                                        a,
                                        a.sym(result).value_declaration,
                                    )
                            {
                                let isolated_modules_like_flag_name: &[u8] =
                                    if self.compiler_options.verbatim_module_syntax
                                        == Tristate::TRUE
                                    {
                                        b"verbatimModuleSyntax"
                                    } else {
                                        b"isolatedModules"
                                    };
                                let qualified_name =
                                    [a.sym(enum_symbol).name, b".".as_slice(), name].concat();
                                self.error(
                                    host,
                                    original_location,
                                    diagnostics::CANNOT_ACCESS_0_FROM_ANOTHER_FILE_WITHOUT_QUALIFICATION_WHEN_1_IS_ENABLED_USE_2_INSTEAD,
                                    &[
                                        Arg::Str(name),
                                        Arg::Str(isolated_modules_like_flag_name),
                                        Arg::Str(&qualified_name),
                                    ],
                                );
                            }
                            break 'resolve;
                        }
                    }
                    Kind::PropertyDeclaration => {
                        if !ast::is_static(a, location) {
                            let ctor = ast::find_constructor_declaration(a, a.parent(location));
                            if !ctor.is_nil() && !a.locals(ctor).is_nil() {
                                if !self
                                    .lookup(
                                        a,
                                        host,
                                        a.locals(ctor),
                                        name,
                                        meaning & SymbolFlags::VALUE,
                                    )
                                    .is_nil()
                                {
                                    // Remember the property node, it will be used later to report appropriate error
                                    property_with_invalid_initializer = location;
                                }
                            }
                        }
                    }
                    Kind::ClassDeclaration | Kind::ClassExpression | Kind::InterfaceDeclaration => {
                        let class_symbol = self.get_symbol_of_declaration(a, host, location);
                        result = self.lookup(
                            a,
                            host,
                            a.sym(class_symbol).members,
                            name,
                            meaning & SymbolFlags::TYPE,
                        );
                        if !result.is_nil() {
                            if !is_type_parameter_symbol_declared_in_container(a, result, location)
                            {
                                // ignore type parameters not declared in this container
                                result = SymbolId::NIL;
                                break 'switch;
                            }
                            if !last_location.is_nil() && ast::is_static(a, last_location) {
                                // TypeScript 1.0 spec (April 2014): 3.4.1 The scope of a type parameter extends over the entire declaration with which the type parameter list is associated, with the exception of static member declarations in classes.
                                if !name_not_found_message.is_nil() {
                                    self.error(
                                        host,
                                        original_location,
                                        diagnostics::STATIC_MEMBERS_CANNOT_REFERENCE_CLASS_TYPE_PARAMETERS,
                                        &[],
                                    );
                                }
                                return SymbolId::NIL;
                            }
                            break 'resolve;
                        }
                        if ast::is_class_expression(a, location)
                            && meaning.intersects(SymbolFlags::CLASS)
                        {
                            let class_name = a.name(location);
                            if !class_name.is_nil() && name == a.text(class_name) {
                                result = a.symbol(location);
                                break 'resolve;
                            }
                        }
                    }
                    Kind::ExpressionWithTypeArguments => {
                        if last_location == a.expression(location)
                            && ast::is_heritage_clause(a, a.parent(location))
                            && a.as_heritage_clause(a.parent(location)).token
                                == Kind::ExtendsKeyword
                        {
                            let container = a.parent(a.parent(location));
                            if ast::is_class_like(a, container) {
                                let container_symbol =
                                    self.get_symbol_of_declaration(a, host, container);
                                result = self.lookup(
                                    a,
                                    host,
                                    a.sym(container_symbol).members,
                                    name,
                                    meaning & SymbolFlags::TYPE,
                                );
                                if !result.is_nil() {
                                    if !name_not_found_message.is_nil() {
                                        self.error(
                                            host,
                                            original_location,
                                            diagnostics::BASE_CLASS_EXPRESSIONS_CANNOT_REFERENCE_CLASS_TYPE_PARAMETERS,
                                            &[],
                                        );
                                    }
                                    return SymbolId::NIL;
                                }
                            }
                        }
                    }
                    // It is not legal to reference a class's own type parameters from a computed property name that belongs to the class. For example, in `function foo<T>() { return '' } class C<T> { [foo<T>()]() { } }` the reference to T from the class's own computed property is an error.
                    Kind::ComputedPropertyName => {
                        let grandparent = a.parent(a.parent(location));
                        if ast::is_class_like(a, grandparent)
                            || ast::is_interface_declaration(a, grandparent)
                        {
                            // A reference to this grandparent's type parameters would be an error
                            let grandparent_symbol =
                                self.get_symbol_of_declaration(a, host, grandparent);
                            result = self.lookup(
                                a,
                                host,
                                a.sym(grandparent_symbol).members,
                                name,
                                meaning & SymbolFlags::TYPE,
                            );
                            if !result.is_nil() {
                                if !name_not_found_message.is_nil() {
                                    self.error(
                                        host,
                                        original_location,
                                        diagnostics::A_COMPUTED_PROPERTY_NAME_CANNOT_REFERENCE_A_TYPE_PARAMETER_FROM_ITS_CONTAINING_TYPE,
                                        &[],
                                    );
                                }
                                return SymbolId::NIL;
                            }
                        }
                    }
                    Kind::MethodDeclaration
                    | Kind::Constructor
                    | Kind::GetAccessor
                    | Kind::SetAccessor
                    | Kind::FunctionDeclaration => {
                        if meaning.intersects(SymbolFlags::VARIABLE) && name == b"arguments" {
                            result = self.arguments_symbol(a);
                            break 'resolve;
                        }
                    }
                    Kind::FunctionExpression => {
                        if meaning.intersects(SymbolFlags::VARIABLE) && name == b"arguments" {
                            result = self.arguments_symbol(a);
                            break 'resolve;
                        }
                        if meaning.intersects(SymbolFlags::FUNCTION) {
                            let function_name = a.as_function_expression(location).name;
                            if !function_name.is_nil() && name == a.text(function_name) {
                                result = a.symbol(location);
                                break 'resolve;
                            }
                        }
                    }
                    Kind::Decorator => {
                        // Decorators are resolved at the class declaration. Resolving at the parameter or member would result in looking up locals in the method. In `function y() {} class C { method(@y x, y) {} }` the decorator y should be resolved at the class declaration, not the parameter.
                        if !a.parent(location).is_nil()
                            && a.kind(a.parent(location)) == Kind::Parameter
                        {
                            location = a.parent(location);
                        }
                        // In `function y() {} class C { @y method(x, y) {} }` the decorator y should be resolved at the class declaration, not the method. Class decorators are resolved outside of the class to avoid referencing type parameters of that class: in `type T = number; declare function y(x: T): any; @param(1 as T) class C<T> {}` T should resolve to the type alias outside of class C.
                        if !a.parent(location).is_nil()
                            && (ast::is_class_element(a, a.parent(location))
                                || a.kind(a.parent(location)) == Kind::ClassDeclaration)
                        {
                            location = a.parent(location);
                        }
                    }
                    Kind::Parameter => {
                        let parameter_declaration = a.as_parameter_declaration(location);
                        if !last_location.is_nil()
                            && (last_location == parameter_declaration.initializer
                                || (last_location == parameter_declaration.name
                                    && ast::is_binding_pattern(a, last_location)))
                        {
                            if associated_declaration_for_containing_initializer_or_binding_name
                                .is_nil()
                            {
                                associated_declaration_for_containing_initializer_or_binding_name =
                                    location;
                            }
                        }
                    }
                    Kind::BindingElement => {
                        let binding_element = a.as_binding_element(location);
                        if !last_location.is_nil()
                            && (last_location == binding_element.initializer
                                || (last_location == binding_element.name
                                    && ast::is_binding_pattern(a, last_location)))
                        {
                            if ast::is_part_of_parameter_declaration(a, location)
                                && associated_declaration_for_containing_initializer_or_binding_name
                                    .is_nil()
                            {
                                associated_declaration_for_containing_initializer_or_binding_name =
                                    location;
                            }
                        }
                    }
                    Kind::InferType => {
                        if meaning.intersects(SymbolFlags::TYPE_PARAMETER) {
                            let type_parameter = a.as_infer_type_node(location).type_parameter;
                            let parameter_name =
                                a.as_type_parameter_declaration(type_parameter).name;
                            if !parameter_name.is_nil() && name == a.text(parameter_name) {
                                result = a.symbol(type_parameter);
                                break 'resolve;
                            }
                        }
                    }
                    Kind::ExportSpecifier => {
                        let export_specifier = a.as_export_specifier(location);
                        if !last_location.is_nil()
                            && last_location == export_specifier.property_name
                            && !a.module_specifier(a.parent(a.parent(location))).is_nil()
                        {
                            location = a.parent(a.parent(a.parent(location)));
                        }
                    }
                    _ => {}
                }
            }
            if is_self_reference_location(a, location, last_location) {
                last_self_reference_location = location;
            }
            last_location = location;
            // !!! In Strada, JSDocTemplateTag/JSDocParameterTag/JSDocReturnTag locations skip to getEffectiveContainerForJSDocTemplateTag/getHostSignatureFromJSDoc instead of location.parent. This is a no-op currently because JSDoc nodes have no locals and getEffectiveJSDocHost is not fully ported for JS assignment patterns.
            location = a.parent(location);
        }
        // We just climbed up parents looking for the name, meaning that we started in a descendant node of `lastLocation`. If `result === lastSelfReferenceLocation.symbol`, that means that we are somewhere inside `lastSelfReferenceLocation` looking up a name, and resolving to `lastLocation` itself. That means that this is a self-reference of `lastLocation`, and shouldn't count this when considering whether `lastLocation` is used.
        if is_use
            && !result.is_nil()
            && (last_self_reference_location.is_nil()
                || result != a.symbol(last_self_reference_location))
        {
            if let Some(symbol_referenced) = self.symbol_referenced {
                symbol_referenced(host, result, meaning);
            }
        }
        if result.is_nil() && !exclude_globals {
            result = self.lookup(
                a,
                host,
                self.globals,
                name,
                meaning | SymbolFlags::GLOBAL_LOOKUP,
            );
        }
        if result.is_nil() {
            if !original_location.is_nil()
                && ast::is_in_js_file(a, original_location)
                && !a.parent(original_location).is_nil()
            {
                if ast::is_require_call(a, a.parent(original_location), false) {
                    return self.require_symbol;
                }
            }
        }
        if !name_not_found_message.is_nil() {
            if !property_with_invalid_initializer.is_nil() {
                if let Some(on_property_with_invalid_initializer) =
                    self.on_property_with_invalid_initializer
                {
                    if on_property_with_invalid_initializer(
                        host,
                        original_location,
                        name,
                        property_with_invalid_initializer,
                        result,
                    ) {
                        return SymbolId::NIL;
                    }
                }
            }
            if result.is_nil() {
                if let Some(on_failed_to_resolve_symbol) = self.on_failed_to_resolve_symbol {
                    on_failed_to_resolve_symbol(
                        host,
                        original_location,
                        name,
                        meaning,
                        name_not_found_message,
                    );
                }
            } else {
                if let Some(on_successfully_resolved_symbol) = self.on_successfully_resolved_symbol
                {
                    on_successfully_resolved_symbol(
                        host,
                        original_location,
                        result,
                        meaning,
                        last_location,
                        associated_declaration_for_containing_initializer_or_binding_name,
                        within_deferred_context,
                    );
                }
            }
        }
        result
    }

    fn use_outer_variable_scope_in_parameter(
        &mut self,
        a: Ast<'_>,
        host: &mut H,
        result: SymbolId,
        location: NodeId,
        last_location: NodeId,
    ) -> bool {
        if ast::is_parameter_declaration(a, last_location) {
            let body = a.body(location);
            let value_declaration = a.sym(result).value_declaration;
            if !body.is_nil()
                && !value_declaration.is_nil()
                && a.pos(value_declaration) >= a.pos(body)
                && a.end(value_declaration) <= a.end(body)
            {
                // check for several cases where we introduce temporaries that require moving the name/initializer of the parameter to the body: static field in a class expression, optional chaining pre-es2020, nullish coalesce pre-es2020, spread assignment in binding pattern pre-es2017
                let function_location = location;
                let mut declaration_requires_scope_change = Tristate::UNKNOWN;
                if let Some(get_requires_scope_change_cache) = self.get_requires_scope_change_cache
                {
                    declaration_requires_scope_change =
                        get_requires_scope_change_cache(host, function_location);
                }
                if declaration_requires_scope_change == Tristate::UNKNOWN {
                    declaration_requires_scope_change =
                        if core::some(a.parameters(function_location).as_slice(), |parameter| {
                            self.requires_scope_change(a, parameter)
                        }) {
                            Tristate::TRUE
                        } else {
                            Tristate::FALSE
                        };
                    if let Some(set_requires_scope_change_cache) =
                        self.set_requires_scope_change_cache
                    {
                        set_requires_scope_change_cache(
                            host,
                            function_location,
                            declaration_requires_scope_change,
                        );
                    }
                }
                return declaration_requires_scope_change != Tristate::TRUE;
            }
        }
        false
    }

    fn requires_scope_change(&self, a: Ast<'_>, node: NodeId) -> bool {
        let d = a.as_parameter_declaration(node);
        let stack_check = StackCheck::init();
        self.requires_scope_change_worker(a, stack_check, d.name)
            || (!d.initializer.is_nil()
                && self.requires_scope_change_worker(a, stack_check, d.initializer))
    }

    fn requires_scope_change_worker(
        &self,
        a: Ast<'_>,
        stack_check: StackCheck,
        node: NodeId,
    ) -> bool {
        if !stack_check.is_safe_to_recurse() {
            a.fault(FaultKind::StackLimit, "stack limit reached", 0, node.0);
            return false;
        }
        match a.kind(node) {
            Kind::ArrowFunction
            | Kind::FunctionExpression
            | Kind::FunctionDeclaration
            | Kind::Constructor => false,
            Kind::MethodDeclaration
            | Kind::GetAccessor
            | Kind::SetAccessor
            | Kind::PropertyAssignment => {
                self.requires_scope_change_worker(a, stack_check, a.name(node))
            }
            Kind::PropertyDeclaration => {
                if ast::has_static_modifier(a, node) {
                    return !self.compiler_options.get_emit_standard_class_fields();
                }
                self.requires_scope_change_worker(
                    a,
                    stack_check,
                    a.as_property_declaration(node).name,
                )
            }
            _ => {
                if ast::is_nullish_coalesce(a, node) || ast::is_optional_chain(a, node) {
                    return self.compiler_options.get_emit_script_target() < ScriptTarget::ES2020;
                }
                if ast::is_binding_element(a, node)
                    && !a.as_binding_element(node).dot_dot_dot_token.is_nil()
                    && ast::is_object_binding_pattern(a, a.parent(node))
                {
                    return self.compiler_options.get_emit_script_target() < ScriptTarget::ES2017;
                }
                if ast::is_type_node(a, node) {
                    return false;
                }
                a.for_each_child(node, &mut |child| {
                    self.requires_scope_change_worker(a, stack_check, child)
                })
            }
        }
    }

    fn error(&mut self, host: &mut H, location: NodeId, message: MessageId, args: &[Arg<'_>]) {
        if let Some(error) = self.error {
            error(host, location, message, args);
        }
        // Default implementation does not report errors
    }

    fn get_symbol_of_declaration(&mut self, a: Ast<'_>, host: &mut H, node: NodeId) -> SymbolId {
        if let Some(get_symbol_of_declaration) = self.get_symbol_of_declaration {
            return get_symbol_of_declaration(host, node);
        }

        // Default implementation does not support merged symbols
        a.symbol(node)
    }

    fn lookup(
        &mut self,
        a: Ast<'_>,
        host: &mut H,
        symbols: SymbolTableId,
        name: &[u8],
        meaning: SymbolFlags,
    ) -> SymbolId {
        if let Some(lookup) = self.lookup {
            return lookup(host, symbols, name, meaning);
        }
        // Default implementation does not support following aliases or merged symbols
        if meaning != SymbolFlags::NONE {
            let symbol = a.table_get(symbols, name);
            if !symbol.is_nil() {
                if a.sym(symbol).flags.intersects(meaning) {
                    return symbol;
                }
            }
        }
        SymbolId::NIL
    }

    fn arguments_symbol(&mut self, a: Ast<'_>) -> SymbolId {
        if self.arguments_symbol.is_nil() {
            // Default implementation synthesizes a transient symbol for `arguments`
            self.arguments_symbol =
                a.new_symbol(SymbolFlags::PROPERTY | SymbolFlags::TRANSIENT, b"arguments");
        }
        self.arguments_symbol
    }
}

pub fn get_local_symbol_for_export_default(a: Ast<'_>, symbol: SymbolId) -> SymbolId {
    if !is_export_default_symbol(a, symbol) || a.sym(symbol).declarations.len() == 0 {
        return SymbolId::NIL;
    }
    for decl in a.sym(symbol).declarations.iter() {
        let local_symbol = a.local_symbol(decl);
        if !local_symbol.is_nil() {
            return local_symbol;
        }
    }
    SymbolId::NIL
}

fn is_export_default_symbol(a: Ast<'_>, symbol: SymbolId) -> bool {
    !symbol.is_nil()
        && a.sym(symbol).declarations.len() > 0
        && ast::has_syntactic_modifier(
            a,
            a.sym(symbol).declarations.at(0usize),
            ModifierFlags::DEFAULT,
        )
}

fn get_is_deferred_context(a: Ast<'_>, location: NodeId, last_location: NodeId) -> bool {
    if a.kind(location) != Kind::ArrowFunction && a.kind(location) != Kind::FunctionExpression {
        // initializers in instance property declaration of class like entities are executed in constructor and thus deferred. A name is evaluated within the enclosing scope - so it shouldn't count as deferred
        return ast::is_type_query_node(a, location)
            || ((ast::is_function_like_declaration(a, location)
                || (a.kind(location) == Kind::PropertyDeclaration
                    && !ast::is_static(a, location)))
                && (last_location.is_nil() || last_location != a.name(location)));
    }
    if !last_location.is_nil() && last_location == a.name(location) {
        return false;
    }
    // generator functions and async functions are not inlined in control flow when immediately invoked
    if a.body_data(location)
        .is_some_and(|body_data| !body_data.asterisk_token.is_nil())
        || ast::has_syntactic_modifier(a, location, ModifierFlags::ASYNC)
    {
        return true;
    }
    ast::get_immediately_invoked_function_expression(a, location).is_nil()
}

fn is_type_parameter_symbol_declared_in_container(
    a: Ast<'_>,
    symbol: SymbolId,
    container: NodeId,
) -> bool {
    for decl in a.sym(symbol).declarations.iter() {
        if a.kind(decl) == Kind::TypeParameter {
            let parent = a.parent(decl);
            if parent == container {
                return true;
            }
        }
    }
    false
}

fn is_self_reference_location(a: Ast<'_>, node: NodeId, last_location: NodeId) -> bool {
    match a.kind(node) {
        Kind::Parameter => !last_location.is_nil() && last_location == a.name(node),
        // For `namespace N { N; }`
        Kind::FunctionDeclaration
        | Kind::ClassDeclaration
        | Kind::InterfaceDeclaration
        | Kind::EnumDeclaration
        | Kind::TypeAliasDeclaration
        | Kind::JSTypeAliasDeclaration
        | Kind::ModuleDeclaration => true,
        _ => false,
    }
}
