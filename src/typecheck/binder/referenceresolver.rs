// Port of internal/binder/referenceresolver.go of typescript-go 89d5d5b.
use crate::ast::{self, Ast, Kind, NodeId, SymbolFlags, SymbolId, SymbolTableId};
use crate::binder::nameresolver::NameResolver;
use crate::core::{self, CompilerOptions, Text};
use crate::diagnostics::MessageId;

pub trait ReferenceResolver<'a, H> {
    fn get_referenced_export_container(
        &mut self,
        a: Ast<'a>,
        host: &mut H,
        node: NodeId,
        prefix_locals: bool,
    ) -> NodeId;
    fn get_referenced_import_declaration(
        &mut self,
        a: Ast<'a>,
        host: &mut H,
        node: NodeId,
    ) -> NodeId;
    fn get_referenced_value_declaration(
        &mut self,
        a: Ast<'a>,
        host: &mut H,
        node: NodeId,
    ) -> NodeId;
    fn get_referenced_value_declarations(
        &mut self,
        a: Ast<'a>,
        host: &mut H,
        node: NodeId,
    ) -> Vec<NodeId>;
    fn get_element_access_expression_name(&mut self, host: &mut H, expression: NodeId) -> Text<'a>;
    fn get_referenced_member_value_declaration(
        &mut self,
        a: Ast<'a>,
        host: &mut H,
        node: NodeId,
    ) -> NodeId;
}

// As in NameResolver, a hook is a function pointer that takes its host first, and a nil hook is `None`.
pub struct ReferenceResolverHooks<'a, H> {
    pub resolve_name:
        Option<fn(&mut H, NodeId, &[u8], SymbolFlags, MessageId, bool, bool) -> SymbolId>,
    pub get_resolved_symbol: Option<fn(&mut H, NodeId) -> SymbolId>,
    pub get_merged_symbol: Option<fn(&mut H, SymbolId) -> SymbolId>,
    pub get_parent_of_symbol: Option<fn(&mut H, SymbolId) -> SymbolId>,
    pub get_symbol_of_declaration: Option<fn(&mut H, NodeId) -> SymbolId>,
    pub get_type_only_alias_declaration: Option<fn(&mut H, SymbolId, SymbolFlags) -> NodeId>,
    pub get_export_symbol_of_value_symbol_if_exported: Option<fn(&mut H, SymbolId) -> SymbolId>,
    pub get_element_access_expression_name: Option<fn(&mut H, NodeId) -> (Text<'a>, bool)>,
}

impl<H> Default for ReferenceResolverHooks<'_, H> {
    fn default() -> Self {
        Self {
            resolve_name: None,
            get_resolved_symbol: None,
            get_merged_symbol: None,
            get_parent_of_symbol: None,
            get_symbol_of_declaration: None,
            get_type_only_alias_declaration: None,
            get_export_symbol_of_value_symbol_if_exported: None,
            get_element_access_expression_name: None,
        }
    }
}

// Upstream's unexported `referenceResolver`, the one implementation of the interface above.
struct ReferenceResolverImpl<'a, 'o, H> {
    resolver: Option<NameResolver<'o, H>>,
    options: &'o CompilerOptions,
    hooks: ReferenceResolverHooks<'a, H>,
}

pub fn new_reference_resolver<'a, 'o, H>(
    options: &'o CompilerOptions,
    hooks: ReferenceResolverHooks<'a, H>,
) -> impl ReferenceResolver<'a, H> {
    ReferenceResolverImpl {
        resolver: None,
        options,
        hooks,
    }
}

impl<'a, H> ReferenceResolverImpl<'a, '_, H> {
    fn get_resolved_symbol(&mut self, host: &mut H, node: NodeId) -> SymbolId {
        if !node.is_nil() {
            if let Some(get_resolved_symbol) = self.hooks.get_resolved_symbol {
                return get_resolved_symbol(host, node);
            }
        }
        SymbolId::NIL
    }

    fn get_merged_symbol(&mut self, host: &mut H, symbol: SymbolId) -> SymbolId {
        if !symbol.is_nil() {
            if let Some(get_merged_symbol) = self.hooks.get_merged_symbol {
                return get_merged_symbol(host, symbol);
            }
            return symbol;
        }
        SymbolId::NIL
    }

    fn get_parent_of_symbol(&mut self, a: Ast<'a>, host: &mut H, symbol: SymbolId) -> SymbolId {
        if !symbol.is_nil() {
            if let Some(get_parent_of_symbol) = self.hooks.get_parent_of_symbol {
                return get_parent_of_symbol(host, symbol);
            }
            return a.sym(symbol).parent;
        }
        SymbolId::NIL
    }

    fn get_symbol_of_declaration(
        &mut self,
        a: Ast<'a>,
        host: &mut H,
        declaration: NodeId,
    ) -> SymbolId {
        if !declaration.is_nil() {
            if let Some(get_symbol_of_declaration) = self.hooks.get_symbol_of_declaration {
                return get_symbol_of_declaration(host, declaration);
            }
            return a.symbol(declaration);
        }
        SymbolId::NIL
    }

    fn get_referenced_value_symbol(
        &mut self,
        a: Ast<'a>,
        host: &mut H,
        reference: NodeId,
        start_in_declaration_container: bool,
    ) -> SymbolId {
        let resolved_symbol = self.get_resolved_symbol(host, reference);
        if !resolved_symbol.is_nil() {
            return resolved_symbol;
        }

        let mut location = reference;
        if start_in_declaration_container
            && !a.parent(reference).is_nil()
            && ast::is_declaration(a, a.parent(reference))
            && a.name(a.parent(reference)) == reference
        {
            location = ast::get_declaration_container(a, a.parent(reference));
        }

        if let Some(resolve_name) = self.hooks.resolve_name {
            return resolve_name(
                host,
                location,
                a.text(reference),
                SymbolFlags::EXPORT_VALUE | SymbolFlags::VALUE | SymbolFlags::ALIAS,
                MessageId::NIL,
                false,
                false,
            );
        }

        let options = self.options;
        let resolver = self.resolver.get_or_insert(NameResolver {
            compiler_options: options,
            get_symbol_of_declaration: None,
            error: None,
            globals: SymbolTableId::NIL,
            arguments_symbol: SymbolId::NIL,
            require_symbol: SymbolId::NIL,
            lookup: None,
            symbol_referenced: None,
            set_requires_scope_change_cache: None,
            get_requires_scope_change_cache: None,
            on_property_with_invalid_initializer: None,
            on_failed_to_resolve_symbol: None,
            on_successfully_resolved_symbol: None,
        });

        resolver.resolve(
            a,
            host,
            location,
            a.text(reference),
            SymbolFlags::EXPORT_VALUE | SymbolFlags::VALUE | SymbolFlags::ALIAS,
            MessageId::NIL,
            false,
            false,
        )
    }

    fn is_type_only_alias_declaration(
        &mut self,
        a: Ast<'a>,
        host: &mut H,
        symbol: SymbolId,
    ) -> bool {
        if !symbol.is_nil() {
            if let Some(get_type_only_alias_declaration) =
                self.hooks.get_type_only_alias_declaration
            {
                return !get_type_only_alias_declaration(host, symbol, SymbolFlags::VALUE).is_nil();
            }

            let mut node = self.get_declaration_of_alias_symbol(a, symbol);
            while !node.is_nil() {
                match a.kind(node) {
                    Kind::ImportEqualsDeclaration | Kind::ExportDeclaration => {
                        return a.is_type_only(node);
                    }
                    Kind::ImportClause | Kind::ImportSpecifier | Kind::ExportSpecifier => {
                        if a.is_type_only(node) {
                            return true;
                        }
                        node = a.parent(node);
                        continue;
                    }
                    Kind::NamedImports | Kind::NamedExports => {
                        node = a.parent(node);
                        continue;
                    }
                    _ => {}
                }
                break;
            }
        }
        false
    }

    fn get_declaration_of_alias_symbol(&mut self, a: Ast<'a>, symbol: SymbolId) -> NodeId {
        core::find_last(a.sym(symbol).declarations.as_slice(), |declaration| {
            ast::is_alias_symbol_declaration(a, declaration)
        })
    }

    fn get_export_symbol_of_value_symbol_if_exported(
        &mut self,
        a: Ast<'a>,
        host: &mut H,
        symbol: SymbolId,
    ) -> SymbolId {
        let mut symbol = symbol;
        if !symbol.is_nil() {
            if let Some(get_export_symbol_of_value_symbol_if_exported) =
                self.hooks.get_export_symbol_of_value_symbol_if_exported
            {
                return get_export_symbol_of_value_symbol_if_exported(host, symbol);
            }
            if a.sym(symbol).flags.intersects(SymbolFlags::EXPORT_VALUE)
                && !a.sym(symbol).export_symbol.is_nil()
            {
                symbol = a.sym(symbol).export_symbol;
            }
            return self.get_merged_symbol(host, symbol);
        }
        SymbolId::NIL
    }
}

impl<'a, H> ReferenceResolver<'a, H> for ReferenceResolverImpl<'a, '_, H> {
    // The result is a SourceFile, a ModuleDeclaration or an EnumDeclaration.
    fn get_referenced_export_container(
        &mut self,
        a: Ast<'a>,
        host: &mut H,
        node: NodeId,
        prefix_locals: bool,
    ) -> NodeId {
        // When resolving the export for the name of a module or enum declaration, we need to start resolution at the declaration's container. Otherwise, we could incorrectly resolve the export as the declaration if it contains an exported member with the same name.
        let start_in_declaration_container = !a.parent(node).is_nil()
            && (a.kind(a.parent(node)) == Kind::ModuleDeclaration
                || a.kind(a.parent(node)) == Kind::EnumDeclaration)
            && node == a.name(a.parent(node));
        let mut symbol =
            self.get_referenced_value_symbol(a, host, node, start_in_declaration_container);
        if !symbol.is_nil() {
            if a.sym(symbol).flags.intersects(SymbolFlags::EXPORT_VALUE) {
                // If we reference an exported entity within the same module declaration, then whether we prefix depends on the kind of entity. SymbolFlags.ExportHasLocal encompasses all the kinds that we do NOT prefix.
                let export_symbol = self.get_merged_symbol(host, a.sym(symbol).export_symbol);
                if !prefix_locals
                    && a.sym(export_symbol)
                        .flags
                        .intersects(SymbolFlags::EXPORT_HAS_LOCAL)
                    && !a.sym(export_symbol).flags.intersects(SymbolFlags::VARIABLE)
                {
                    return NodeId::NIL;
                }
                symbol = export_symbol;
            }
            let parent_symbol = self.get_parent_of_symbol(a, host, symbol);
            if !parent_symbol.is_nil() {
                let parent = a.sym(parent_symbol);
                if parent.flags.intersects(SymbolFlags::VALUE_MODULE)
                    && !parent.value_declaration.is_nil()
                    && a.kind(parent.value_declaration) == Kind::SourceFile
                {
                    let symbol_file = parent.value_declaration;
                    let reference_file = ast::get_source_file_of_node(a, node);
                    // If `node` accesses an export and that export isn't in the same file, then symbol is a namespace export, so return nil.
                    let symbol_is_umd_export = symbol_file != reference_file;
                    if symbol_is_umd_export {
                        return NodeId::NIL;
                    }
                    return symbol_file;
                }
                return ast::find_ancestor(a, a.parent(node), |n| {
                    (a.kind(n) == Kind::ModuleDeclaration || a.kind(n) == Kind::EnumDeclaration)
                        && self.get_symbol_of_declaration(a, host, n) == parent_symbol
                });
            }
        }

        NodeId::NIL
    }

    fn get_referenced_import_declaration(
        &mut self,
        a: Ast<'a>,
        host: &mut H,
        node: NodeId,
    ) -> NodeId {
        let symbol = self.get_referenced_value_symbol(a, host, node, false);
        if !symbol.is_nil() {
            // We should only get the declaration of an alias if there isn't a local value declaration for the symbol
            if ast::is_non_local_alias(a, symbol, SymbolFlags::VALUE)
                && !self.is_type_only_alias_declaration(a, host, symbol)
            {
                return self.get_declaration_of_alias_symbol(a, symbol);
            }
        }

        NodeId::NIL
    }

    fn get_referenced_value_declaration(
        &mut self,
        a: Ast<'a>,
        host: &mut H,
        node: NodeId,
    ) -> NodeId {
        let symbol = self.get_referenced_value_symbol(a, host, node, false);
        if !symbol.is_nil() {
            let export_symbol = self.get_export_symbol_of_value_symbol_if_exported(a, host, symbol);
            return a.sym(export_symbol).value_declaration;
        }
        NodeId::NIL
    }

    fn get_referenced_value_declarations(
        &mut self,
        a: Ast<'a>,
        host: &mut H,
        node: NodeId,
    ) -> Vec<NodeId> {
        let mut declarations = Vec::new();
        let symbol = self.get_referenced_value_symbol(a, host, node, false);
        if !symbol.is_nil() {
            let symbol = self.get_export_symbol_of_value_symbol_if_exported(a, host, symbol);
            for declaration in a.sym(symbol).declarations.iter() {
                match a.kind(declaration) {
                    Kind::VariableDeclaration
                    | Kind::Parameter
                    | Kind::BindingElement
                    | Kind::PropertyDeclaration
                    | Kind::PropertyAssignment
                    | Kind::ShorthandPropertyAssignment
                    | Kind::EnumMember
                    | Kind::ObjectLiteralExpression
                    | Kind::FunctionDeclaration
                    | Kind::FunctionExpression
                    | Kind::ArrowFunction
                    | Kind::ClassDeclaration
                    | Kind::ClassExpression
                    | Kind::EnumDeclaration
                    | Kind::MethodDeclaration
                    | Kind::GetAccessor
                    | Kind::SetAccessor
                    | Kind::ModuleDeclaration => {
                        declarations.push(declaration);
                    }
                    _ => {}
                }
            }
        }
        declarations
    }

    fn get_element_access_expression_name(&mut self, host: &mut H, expression: NodeId) -> Text<'a> {
        if !expression.is_nil() {
            if let Some(get_element_access_expression_name) =
                self.hooks.get_element_access_expression_name
            {
                let (name, ok) = get_element_access_expression_name(host, expression);
                if ok {
                    return name;
                }
            }
        }
        b""
    }

    fn get_referenced_member_value_declaration(
        &mut self,
        a: Ast<'a>,
        host: &mut H,
        node: NodeId,
    ) -> NodeId {
        // member references are `this.something` or `this[something]`, so should always simply have a resolved symbol
        let mut s = self.get_resolved_symbol(host, node);
        if s.is_nil() && !a.symbol(node).is_nil() {
            // might be a declaration instead of a ref, get the merged declaration symbol
            s = self.get_merged_symbol(host, a.symbol(node));
        }
        if s.is_nil() {
            return NodeId::NIL;
        }
        let export_symbol = self.get_export_symbol_of_value_symbol_if_exported(a, host, s);
        a.sym(export_symbol).value_declaration
    }
}
