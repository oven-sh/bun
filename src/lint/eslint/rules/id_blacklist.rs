use bun_lint::prelude::*;
use rustc_hash::FxHashSet;

/// Disallow specified identifiers.
pub struct IdBlacklist {
    names: FxHashSet<Vec<u8>>,
}

const RESTRICTED: Message = Message::new("restricted", "Identifier '{{name}}' is restricted.");

fn report<'a>(at: Span, name: &'a [u8], cx: &Cx<'a, IdBlacklist>) {
    cx.report(at, RESTRICTED).data("name", name);
}

impl IdBlacklist {
    /// A private name is a `PrivateIdentifier`, which is not checked.
    #[inline]
    fn is_restricted(&self, name: Name) -> bool {
        let name = name.bytes();
        self.names.contains(name) && !name.starts_with(b"#")
    }

    /// An `Identifier` that is checked wherever it is, and does not refer to anything.
    fn check_name<'a>(&self, name: Ident<'a>, cx: &Cx<'a, Self>) {
        if self.is_restricted(name.name()) && !name.is_string() {
            report(name.span(), name.bytes(), cx);
        }
    }

    /// The same for a keyword that ESLint has as an `Identifier`.
    fn check_keyword<'a>(&self, at: Span, cx: &Cx<'a, Self>) {
        let name = cx.slice(at);
        if self.names.contains(name) {
            report(at, name, cx);
        }
    }

    /// The same for a name that is a reference and not an expression: in a type, in an export.
    fn check_referencing_name<'a>(&self, name: Ident<'a>, cx: &Cx<'a, Self>) {
        if self.is_restricted(name.name())
            && !name.is_string()
            && !cx.file().reference_at(name.start()).is_some_and(|it| it.global().is_some())
        {
            report(name.span(), name.bytes(), cx);
        }
    }

    /// A key that is an `Identifier`.
    fn check_key<'a>(&self, key: Key<'a>, cx: &Cx<'a, Self>) {
        if let KeyKind::Ident(name) = key.kind()
            && self.is_restricted(name)
        {
            report(key.span(cx.file()), name.bytes(), cx);
        }
    }

    fn check_import_attributes<'a>(&self, attributes: ImportAttributes<'a>, cx: &Cx<'a, Self>) {
        attributes.entries().iter().filter_map(Prop::key).for_each(|key| self.check_key(key, cx));
    }

    fn check_reference<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let Some(name) = e.as_ident() else {
            return;
        };
        if !self.is_restricted(name) {
            return;
        }
        let is_checked = match e.parent() {
            Node::Expr(parent) => !matches!(parent.tag(), ExprTag::Call | ExprTag::New),
            // The key of `{ a }` is at the same place, and `check_property` decides.
            Node::Prop(prop) if prop.kind() == PropKind::Shorthand => {
                matches!(prop.parent(), Node::Expr(object) if utils::is_assignment_target(object))
            }
            _ => true,
        };
        if is_checked
            && !e.is_jsx_tag_name()
            && !e.reference().is_some_and(|it| it.global().is_some())
        {
            report(e.span(), name.bytes(), cx);
        }
    }

    /// The `b` of `a.b`: reading it is allowed, the object may not be the user's.
    fn check_property_name<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let ExprKind::Dot { name, .. } = e.kind() else {
            return;
        };
        if !self.is_restricted(name.name()) {
            return;
        }
        // Upstream's `isAssignmentTarget` leaves out the head of a `for`-`in` and a `for`-`of`.
        let is_written = utils::is_assignment_target(e) && !matches!(e.parent(), Node::Stmt(_));
        if is_written || utils::is_in_type_query(e) {
            report(name.span(), name.bytes(), cx);
        }
    }

    /// The key of a property of an object literal. In the target of an assignment it is the name
    /// of a property of somebody else's object.
    fn check_property<'a>(&self, prop: Prop<'a>, cx: &mut Cx<'a, Self>) {
        if let Some(key) = prop.key()
            && let KeyKind::Ident(name) = key.kind()
            && self.is_restricted(name)
            && !prop.is_jsx_attribute()
            && let Node::Expr(object) = prop.parent()
            && !utils::is_assignment_target(object)
        {
            report(key.span(cx.file()), name.bytes(), cx);
        }
    }

    fn check_statement<'a>(&self, statement: Stmt<'a>, cx: &mut Cx<'a, Self>) {
        match statement.kind() {
            StmtKind::Labeled { .. } | StmtKind::Break(_) | StmtKind::Continue(_) => {
                if let Some(label) = statement.label() {
                    self.check_name(label, cx);
                }
            }
            StmtKind::Import(import) => {
                for name in [import.default(), import.namespace()].into_iter().flatten() {
                    self.check_name(name, cx);
                }
            }
            StmtKind::ExportStar { alias: Some(alias), .. } => self.check_name(alias, cx),
            StmtKind::Interface(it) => self.check_name(it.name(), cx),
            StmtKind::TypeAlias(it) => self.check_name(it.name(), cx),
            StmtKind::Enum(it) => self.check_name(it.name(), cx),
            StmtKind::Module(module) => {
                // `namespace A.B.C`
                let mut at = Some(module);
                while let Some(it) = at {
                    match it.name() {
                        ModuleName::Ident(name) => self.check_name(name, cx),
                        ModuleName::String(_) => {}
                        ModuleName::Global => self.check_keyword(it.name_span(), cx),
                    }
                    at = it.nested();
                }
            }
            StmtKind::ImportEquals(it) => {
                self.check_name(it.name(), cx);
                if let ImportEqualsTarget::Entity(name) = it.target() {
                    self.check_entity_name(name, true, cx);
                }
            }
            StmtKind::ExportAsNamespace(_) => {
                if let Some(name) = statement.namespace_export_name() {
                    self.check_name(name, cx);
                }
            }
            _ => {}
        }
        if let Some(attributes) = statement.import_attributes() {
            self.check_import_attributes(attributes, cx);
        }
    }

    /// `a.b.c`. `is_qualified_name`: ESLint has `TSQualifiedName`s, not `MemberExpression`s, in
    /// which only the first name is checked.
    fn check_entity_name<'a>(&self, name: EntityName<'a>, is_qualified_name: bool, cx: &Cx<'a, Self>) {
        let mut parts = name.parts();
        if let Some(first) = parts.next() {
            self.check_referencing_name(first, cx);
        }
        if is_qualified_name {
            parts.for_each(|part| self.check_name(part, cx));
        }
    }

    fn check_type<'a>(&self, ty: TypeNode<'a>, cx: &mut Cx<'a, Self>) {
        match ty.kind() {
            // The `a.b` of `extends a.b` and `implements a.b` is a `MemberExpression`.
            TypeKind::Ref { name, .. } => {
                let is_qualified_name =
                    name.len() > 1 && utils::estree_type_name(ty.into()) == "TSTypeReference";
                self.check_entity_name(name, is_qualified_name, cx);
            }
            TypeKind::Import { name, .. } => {
                name.parts().for_each(|part| self.check_name(part, cx));
                if let Some(attributes) = ty.import_attributes() {
                    self.check_keyword(attributes.keyword_span(), cx);
                    self.check_import_attributes(attributes, cx);
                }
            }
            TypeKind::Predicate { .. } => {
                if let Some(param) = ty.predicate_param()
                    && !param.name().is("this")
                {
                    self.check_name(param, cx);
                }
            }
            TypeKind::Tuple(elements) => {
                elements.iter().filter_map(TupleElem::name).for_each(|name| self.check_name(name, cx));
            }
            _ => {}
        }
    }

    fn check_export_specifier<'a>(&self, specifier: ExportSpec<'a>, cx: &mut Cx<'a, Self>) {
        let has_from = specifier.export().has_from();
        if specifier.is_renamed() {
            self.check_name(specifier.exported(), cx);
            if !has_from {
                self.check_referencing_name(specifier.local(), cx);
            }
        } else if has_from || cx.uses_typescript_parser() {
            // typescript-estree has a node for `exported` at the same place, which refers to nothing.
            self.check_name(specifier.local(), cx);
        } else {
            self.check_referencing_name(specifier.local(), cx);
        }
    }
}

impl Rule for IdBlacklist {
    const META: Meta = Meta::eslint("id-blacklist", Kind::Suggestion).deprecated();
    const ON: On = On::new()
        .exprs(&[
            ExprTag::Ident,
            ExprTag::Dot,
            ExprTag::ImportMeta,
            ExprTag::NewTarget,
            ExprTag::AsConst,
        ])
        .pats(&[PatTag::Ident])
        .props()
        .members()
        .funcs()
        .classes()
        .stmts(&[
            StmtTag::Labeled,
            StmtTag::Break,
            StmtTag::Continue,
            StmtTag::Import,
            StmtTag::ExportNamed,
            StmtTag::ExportStar,
            StmtTag::Interface,
            StmtTag::TypeAlias,
            StmtTag::Enum,
            StmtTag::Module,
            StmtTag::ImportEquals,
            StmtTag::ExportAsNamespace,
        ])
        .import_specs()
        .export_specs()
        .types(&[TypeTag::Ref, TypeTag::Import, TypeTag::Predicate, TypeTag::Tuple])
        .type_params()
        .enum_members();
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        IdBlacklist {
            names: options.all().iter().filter_map(|it| it.as_str().map(<[u8]>::to_vec)).collect(),
        }
    }

    fn narrow<'a>(&self, file: &'a File<'a>) -> On {
        let on = On::new()
            .exprs(&[ExprTag::Ident, ExprTag::Dot, ExprTag::ImportMeta, ExprTag::NewTarget])
            .pats(&[PatTag::Ident])
            .props()
            .members()
            .funcs()
            .classes()
            .stmts(&[
                StmtTag::Labeled,
                StmtTag::Break,
                StmtTag::Continue,
                StmtTag::Import,
                StmtTag::ExportNamed,
                StmtTag::ExportStar,
            ])
            .import_specs()
            .export_specs();
        if file.is_javascript() {
            return on;
        }
        on.stmts(&[
            StmtTag::Interface,
            StmtTag::TypeAlias,
            StmtTag::Enum,
            StmtTag::Module,
            StmtTag::ImportEquals,
            StmtTag::ExportAsNamespace,
        ])
        .types(&[TypeTag::Ref, TypeTag::Import, TypeTag::Predicate, TypeTag::Tuple])
        .type_params()
        .enum_members()
        .exprs(&[ExprTag::AsConst])
    }

    fn start<'a>(&self, _: &'a File<'a>) -> Option<()> {
        if self.names.is_empty() {
            return None;
        }
        Some(())
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        match e.tag() {
            ExprTag::Ident => self.check_reference(e, cx),
            ExprTag::Dot => self.check_property_name(e, cx),
            ExprTag::ImportMeta | ExprTag::NewTarget => {
                if let Some((meta, property)) = e.meta_property_spans() {
                    self.check_keyword(meta, cx);
                    self.check_keyword(property, cx);
                }
            }
            ExprTag::AsConst => {
                if let Some(keyword) = e.const_keyword_span() {
                    self.check_keyword(keyword, cx);
                }
            }
            _ => {}
        }
    }

    fn stmt<'a>(&self, statement: Stmt<'a>, cx: &mut Cx<'a, Self>) {
        self.check_statement(statement, cx);
    }

    fn ty<'a>(&self, ty: TypeNode<'a>, cx: &mut Cx<'a, Self>) {
        self.check_type(ty, cx);
    }

    fn pat<'a>(&self, pat: Pat<'a>, cx: &mut Cx<'a, Self>) {
        if let Some(name) = pat.as_ident()
            && self.is_restricted(name)
        {
            report(utils::estree_span(pat.into()), name.bytes(), cx);
        }
    }

    fn func<'a>(&self, func: Func<'a>, cx: &mut Cx<'a, Self>) {
        if let Some(name) = func.name() {
            self.check_name(name, cx);
        }
    }

    fn class<'a>(&self, class: Class<'a>, cx: &mut Cx<'a, Self>) {
        if let Some(name) = class.name() {
            self.check_name(name, cx);
        }
    }

    fn member<'a>(&self, member: Member<'a>, cx: &mut Cx<'a, Self>) {
        match member.key() {
            Some(key) => self.check_key(key, cx),
            None => {
                if let Some(keyword) = member.constructor_keyword() {
                    self.check_name(keyword, cx);
                }
            }
        }
    }

    fn prop<'a>(&self, prop: Prop<'a>, cx: &mut Cx<'a, Self>) {
        self.check_property(prop, cx);
    }

    fn type_param<'a>(&self, param: TypeParam<'a>, cx: &mut Cx<'a, Self>) {
        self.check_name(param.name(), cx);
    }

    fn enum_member<'a>(&self, member: EnumMember<'a>, cx: &mut Cx<'a, Self>) {
        if let Some(key) = member.key() {
            self.check_key(key, cx);
        }
    }

    // The name in the other module is not the user's, unless it is also the local one.
    fn import_spec<'a>(&self, specifier: ImportSpec<'a>, cx: &mut Cx<'a, Self>) {
        self.check_name(specifier.local(), cx);
    }

    fn export_spec<'a>(&self, specifier: ExportSpec<'a>, cx: &mut Cx<'a, Self>) {
        self.check_export_specifier(specifier, cx);
    }
}
