use super::super::*;
use super::{CheckResult, invalid};

trait NodeId: Copy + Into<u32> + From<u32> {
    fn is_none(self) -> bool;
    fn vector_len(file: &File<'_>) -> usize;
}

macro_rules! node_ids {
    ($($id:ident $vector:ident,)*) => {$(
        impl NodeId for $id {
            #[inline]
            fn is_none(self) -> bool {
                $id::is_none(self)
            }
            #[inline]
            fn vector_len(file: &File<'_>) -> usize {
                file.$vector.len()
            }
        }
    )*};
}

node_ids! {
    ExprId exprs,
    StmtId stmts,
    TypeNodeId types,
    PatId pats,
    PatPropId pat_props,
    PatElemId pat_elems,
    FnId fns,
    ParamId params,
    TypeParamId type_params,
    ClassId classes,
    InterfaceId interfaces,
    AliasId aliases,
    EnumId enums,
    EnumMemberId enum_members,
    ModuleId modules,
    MemberId members,
    PropId props,
    VarDeclId var_decls,
    CallId calls,
    CaseId cases,
    JsxId jsx,
    ImportId imports,
    ImportSpecId import_specs,
    ImportEqualsId import_equals,
    ExportId exports,
    ExportSpecId export_specs,
    TupleElemId tuple_elems,
    MappedId mapped,
    ModifierId modifiers,
    NameId names,
}

#[derive(Copy, Clone)]
struct RangeChecker<'f, 's> {
    file: &'f File<'s>,
    node: NodeData,
}

impl RangeChecker<'_, '_> {
    fn check_id<T: NodeId>(&self, id: T) -> CheckResult {
        self.check_index(id.into(), T::vector_len(self.file))
    }

    fn check_optional_id<T: NodeId>(&self, id: T) -> CheckResult {
        if id.is_none() {
            return Ok(());
        }
        self.check_id(id)
    }

    fn check_ids<T: NodeId>(&self, ids: impl IntoIterator<Item = T>) -> CheckResult {
        ids.into_iter().try_for_each(|id| self.check_id(id))
    }

    fn check_number(&self, index: u32) -> CheckResult {
        self.check_index(index, self.file.numbers.len())
    }

    fn check_index(&self, index: u32, vector_len: usize) -> CheckResult {
        if (index as usize) < vector_len {
            return Ok(());
        }
        invalid(FileRule::IdOutOfRange, self.node)
    }

    fn check_range(&self, start: u32, len: usize, vector_len: usize) -> CheckResult {
        if start as usize + len <= vector_len {
            return Ok(());
        }
        invalid(FileRule::ListOutOfRange, self.node)
    }

    fn check_span<T: NodeId>(&self, span: Span<T>) -> CheckResult {
        self.check_range(span.start, span.len(), T::vector_len(self.file))
    }

    fn check_text_list(&self, list: IdList<Atom>) -> CheckResult {
        self.check_range(list.start, list.len(), self.file.ids.len())
    }

    fn check_list<T: NodeId>(&self, list: IdList<T>) -> CheckResult {
        self.check_range(list.start, list.len(), self.file.ids.len())?;
        for id in self.file.ids(list) {
            self.check_optional_id::<T>(id)?;
        }
        Ok(())
    }

    fn check_list_at<T: NodeId>(&self, list: ListAt<T>) -> CheckResult {
        if list.is_empty() {
            return Ok(());
        }
        self.check_range(list.at, 2, self.file.ids.len())?;
        self.check_list(self.file.list_at(list))
    }

    fn check_branches(&self, branches: BranchesAt) -> CheckResult {
        self.check_range(branches.0, 2, self.file.ids.len())?;
        let Branches { yes, no } = self.file.branches(branches);
        self.check_ids([yes, no])
    }

    fn check_template(&self, exprs: IdList<ExprId>) -> CheckResult {
        let ids_len = self.file.ids.len();
        self.check_range(exprs.start, 2 * exprs.len() + 1, ids_len)?;
        self.check_list(exprs)
    }

    fn check_key(&self, key: PropKey) -> CheckResult {
        match key {
            PropKey::None | PropKey::Name(_) | PropKey::Private(_) => Ok(()),
            PropKey::Computed(expr) => self.check_id(expr),
        }
    }
}

fn check_vector<T, I: From<u32>>(
    file: &File<'_>,
    vector: &[T],
    node: fn(I) -> NodeData,
    check: fn(RangeChecker<'_, '_>, &T) -> CheckResult,
) -> CheckResult {
    for (index, item) in vector.iter().enumerate() {
        let node = node(I::from(index as u32));
        check(RangeChecker { file, node }, item)?;
    }
    Ok(())
}

fn file_node(_: u32) -> NodeData {
    NodeData::File
}

pub(super) fn check_ranges(file: &File<'_>) -> CheckResult {
    let node = NodeData::File;
    let checker = RangeChecker { file, node };
    checker.check_list(file.body)?;
    check_node_vectors(file)?;
    check_declaration_vectors(file)?;
    check_side_tables(checker)?;
    check_jsdoc_side_tables(checker)
}

fn check_node_vectors(file: &File<'_>) -> CheckResult {
    check_vector(file, &file.exprs, NodeData::Expr, check_expr)?;
    check_vector(file, &file.stmts, NodeData::Stmt, check_stmt)?;
    for &(stmt, modifiers) in file.modifiers_of_stmts.iter() {
        let node = NodeData::Stmt(stmt);
        RangeChecker { file, node }.check_id(stmt)?;
        RangeChecker { file, node }.check_span(modifiers)?;
    }
    check_vector(file, &file.types, NodeData::Type, check_type)?;
    check_vector(file, &file.pats, NodeData::Pat, check_pat)?;
    check_vector(file, &file.pat_props, NodeData::PatProp, check_pat_prop)?;
    check_vector(file, &file.pat_elems, NodeData::PatElem, check_pat_elem)?;
    check_vector(file, &file.params, NodeData::Param, check_param)?;
    let param_modifiers = &file.modifiers_of_params;
    check_vector(file, param_modifiers, NodeData::Param, check_modifier_list)?;
    check_vector(file, &file.type_params, NodeData::TypeParam, check_type_param)?;
    check_vector(file, &file.members, NodeData::Member, check_member)?;
    check_vector(file, &file.props, NodeData::Prop, check_prop)?;
    for &(prop, modifiers) in file.modifiers_of_props.iter() {
        let node = NodeData::Prop(prop);
        RangeChecker { file, node }.check_id(prop)?;
        RangeChecker { file, node }.check_span(modifiers)?;
    }
    check_vector(file, &file.var_decls, NodeData::VarDecl, check_var_decl)?;
    check_vector(file, &file.cases, NodeData::Case, check_case)?;
    check_vector(file, &file.enum_members, NodeData::EnumMember, check_enum_member)?;
    check_vector(file, &file.import_specs, NodeData::ImportSpec, check_import_spec)?;
    check_vector(file, &file.export_specs, NodeData::ExportSpec, check_export_spec)?;
    check_vector(file, &file.tuple_elems, NodeData::TupleElem, check_tuple_elem)?;
    check_vector(file, &file.modifiers, NodeData::Modifier, check_modifier)
}

fn check_declaration_vectors(file: &File<'_>) -> CheckResult {
    check_vector(file, &file.fns, file_node, check_function)?;
    check_vector(file, &file.classes, file_node, check_class)?;
    check_vector(file, &file.calls, file_node, check_call)?;
    check_vector(file, &file.jsx, file_node, check_jsx)?;
    check_vector(file, &file.imports, file_node, check_import)?;
    check_vector(file, &file.exports, file_node, check_export)?;
    check_vector(file, &file.interfaces, file_node, check_interface)?;
    check_vector(file, &file.aliases, file_node, check_alias)?;
    check_vector(file, &file.enums, file_node, check_enum)?;
    check_vector(file, &file.modules, file_node, check_module)?;
    check_vector(file, &file.import_equals, file_node, check_import_equals)?;
    check_vector(file, &file.mapped, file_node, check_mapped)
}

fn check_side_tables(checker: RangeChecker<'_, '_>) -> CheckResult {
    let file = checker.file;
    for &(owner, decorator) in file.decorators.iter() {
        match owner {
            DecoratorOwner::Class(class) => checker.check_id(class)?,
            DecoratorOwner::Member(member) => checker.check_id(member)?,
            DecoratorOwner::Param(param) => checker.check_id(param)?,
        }
        checker.check_id(decorator)?;
    }
    checker.check_ids(file.body_starts.iter().map(|entry| entry.0))?;
    checker.check_ids(file.deferred_import_calls.iter().map(|entry| entry.0))?;
    for &(specifier, type_args) in file.import_call_type_args.iter() {
        checker.check_id(specifier)?;
        checker.check_list(type_args)?;
    }
    checker.check_ids(file.import_attributes.iter().map(|entry| entry.1))?;
    checker.check_ids(file.specifier_expressions.iter().copied())?;
    for &(stmt, specifier) in file.exports_from_expressions.iter() {
        checker.check_id(stmt)?;
        checker.check_id(specifier)?;
    }
    checker.check_ids(file.parens.iter().map(|entry| entry.0))?;
    checker.check_ids(file.non_null_ends.iter().map(|entry| entry.0))?;
    checker.check_ids(file.far_names.iter().map(|entry| entry.0))?;
    for &(call, template) in file.tagged_templates.iter() {
        checker.check_id(call)?;
        checker.check_id(template)?;
    }
    checker.check_ids(file.jsx_expressions.iter().map(|entry| entry.0))?;
    checker.check_ids(file.template_part_starts.iter().map(|entry| entry.0))?;
    checker.check_ids(file.jsx_attribute_texts.iter().map(|entry| entry.0))?;
    for &(stmt, attributes) in file.export_star_attributes.iter() {
        checker.check_id(stmt)?;
        checker.check_id(attributes)?;
    }
    Ok(())
}

fn check_jsdoc_side_tables(checker: RangeChecker<'_, '_>) -> CheckResult {
    let file = checker.file;
    for &(owner, ty) in file.jsdoc_types.iter() {
        match owner {
            JsDocTypeOwner::Fn(function) => checker.check_id(function)?,
            JsDocTypeOwner::Prop(prop) => checker.check_id(prop)?,
            JsDocTypeOwner::Assign(assignment) => checker.check_id(assignment)?,
            JsDocTypeOwner::Export(stmt) => checker.check_id(stmt)?,
        }
        checker.check_optional_id(ty)?;
    }
    checker.check_ids(file.jsdoc_modifiers.iter().map(|entry| entry.0))?;
    checker.check_ids(file.jsdoc_member_comments.iter().map(|entry| entry.0))?;
    checker.check_ids(file.jsdoc_param_errors.iter().map(|entry| entry.0))?;
    checker.check_ids(file.functions_with_param_tags.iter().copied())?;
    checker.check_ids(file.unmatched_augments_tags.iter().map(|entry| entry.0))
}

fn check_expr(checker: RangeChecker<'_, '_>, expr: &Expr) -> CheckResult {
    match expr.kind {
        ExprKind::Missing
        | ExprKind::Ident(_)
        | ExprKind::PrivateIdentifier(_)
        | ExprKind::This
        | ExprKind::Super
        | ExprKind::Null
        | ExprKind::True
        | ExprKind::False
        | ExprKind::String(_)
        | ExprKind::BigInt(_)
        | ExprKind::Regex { .. }
        | ExprKind::ImportMeta
        | ExprKind::NewTarget(_)
        | ExprKind::JsxText(_) => Ok(()),
        ExprKind::Number(index) => checker.check_number(index),
        ExprKind::Template { exprs } => checker.check_template(exprs),
        ExprKind::TaggedTemplate(call) | ExprKind::Call(call) | ExprKind::New(call) => {
            checker.check_id(call)
        }
        ExprKind::Array(items) => checker.check_list(items),
        ExprKind::Object(props) => checker.check_span(props),
        ExprKind::Fn(function) => checker.check_id(function),
        ExprKind::Class(class) => checker.check_id(class),
        ExprKind::Index { obj, index, .. } => checker.check_ids([obj, index]),
        ExprKind::Binary { left, right, .. } => checker.check_ids([left, right]),
        ExprKind::Assign { target, value, .. } => checker.check_ids([target, value]),
        ExprKind::Cond { test, branches } => {
            checker.check_id(test)?;
            checker.check_branches(branches)
        }
        ExprKind::Dot { obj: operand, .. }
        | ExprKind::Unary { operand, .. }
        | ExprKind::Spread(operand)
        | ExprKind::Await(operand)
        | ExprKind::AsConst(operand)
        | ExprKind::NonNull(operand) => checker.check_id(operand),
        ExprKind::Yield { value, .. } => checker.check_optional_id(value),
        ExprKind::As { expr, ty } | ExprKind::Satisfies { expr, ty } => {
            checker.check_id(expr)?;
            checker.check_id(ty)
        }
        ExprKind::Instantiation { expr, type_args } => {
            checker.check_id(expr)?;
            checker.check_list_at(type_args)
        }
        ExprKind::Jsx(jsx) => checker.check_id(jsx),
        ExprKind::ImportCall { args } => checker.check_list(args),
    }
}

fn check_stmt(checker: RangeChecker<'_, '_>, stmt: &Stmt) -> CheckResult {
    match stmt.kind {
        StmtKind::Empty
        | StmtKind::Debugger
        | StmtKind::Break(_)
        | StmtKind::Continue(_)
        | StmtKind::ExportStar { .. }
        | StmtKind::ExportAsNamespace(_) => Ok(()),
        StmtKind::Expr(expr)
        | StmtKind::Throw(expr)
        | StmtKind::ExportDefault(expr)
        | StmtKind::ExportAssign(expr)
        | StmtKind::Directive { expr, .. } => checker.check_id(expr),
        StmtKind::Return(expr) => checker.check_optional_id(expr),
        StmtKind::Var(decls) => checker.check_span(decls),
        StmtKind::Fn(function) => checker.check_id(function),
        StmtKind::Class(class) => checker.check_id(class),
        StmtKind::Interface(interface) => checker.check_id(interface),
        StmtKind::TypeAlias(alias) => checker.check_id(alias),
        StmtKind::Enum(enumeration) => checker.check_id(enumeration),
        StmtKind::Module(module) => checker.check_id(module),
        StmtKind::If { test, yes, no } => {
            checker.check_id(test)?;
            checker.check_id(yes)?;
            checker.check_optional_id(no)
        }
        StmtKind::For {
            init,
            test,
            update,
            body,
        } => {
            checker.check_optional_id(init)?;
            checker.check_optional_id(test)?;
            checker.check_optional_id(update)?;
            checker.check_id(body)
        }
        StmtKind::ForIn { left, expr, body } | StmtKind::ForOf { left, expr, body, .. } => {
            checker.check_id(left)?;
            checker.check_id(expr)?;
            checker.check_id(body)
        }
        StmtKind::While { test: expr, body }
        | StmtKind::DoWhile { body, test: expr }
        | StmtKind::With { object: expr, body } => {
            checker.check_id(expr)?;
            checker.check_id(body)
        }
        StmtKind::Block(list) => checker.check_list(list),
        StmtKind::Switch { expr, cases } => {
            checker.check_id(expr)?;
            checker.check_span(cases)
        }
        StmtKind::Try {
            block,
            param,
            handler,
            finalizer,
        } => {
            checker.check_id(block)?;
            checker.check_optional_id(param)?;
            checker.check_optional_id(handler)?;
            checker.check_optional_id(finalizer)
        }
        StmtKind::Labeled { body, .. } => checker.check_id(body),
        StmtKind::Import(import) => checker.check_id(import),
        StmtKind::ImportEquals(import) => checker.check_id(import),
        StmtKind::ExportNamed(export) => checker.check_id(export),
    }
}

fn check_type(checker: RangeChecker<'_, '_>, ty: &TypeNode) -> CheckResult {
    match ty.kind {
        TypeNodeKind::Error
        | TypeNodeKind::Keyword(_)
        | TypeNodeKind::StringLit(_)
        | TypeNodeKind::BigIntLit { .. }
        | TypeNodeKind::BoolLit(_)
        | TypeNodeKind::UniqueSymbol => Ok(()),
        TypeNodeKind::Heritage { expr, args } => {
            checker.check_id(expr)?;
            checker.check_list(args)
        }
        TypeNodeKind::Ref { name, args } | TypeNodeKind::Import { name, args, .. } => {
            checker.check_span(name)?;
            checker.check_list(args)
        }
        TypeNodeKind::NumberLit(index) => checker.check_number(index),
        TypeNodeKind::Template { types, texts } => {
            checker.check_list(types)?;
            checker.check_text_list(texts)
        }
        TypeNodeKind::Array(element)
        | TypeNodeKind::Keyof(element)
        | TypeNodeKind::Readonly(element)
        | TypeNodeKind::Unique(element)
        | TypeNodeKind::JSDoc { ty: element, .. } => checker.check_id(element),
        TypeNodeKind::Predicate { ty, .. } => checker.check_optional_id(ty),
        TypeNodeKind::Tuple(elements) => checker.check_span(elements),
        TypeNodeKind::Union(types) | TypeNodeKind::Intersection(types) => checker.check_list(types),
        TypeNodeKind::Fn(function) => checker.check_id(function),
        TypeNodeKind::Object(members) => checker.check_span(members),
        TypeNodeKind::Cond {
            check,
            extends,
            yes,
            no,
        } => checker.check_ids([check, extends, yes, no]),
        TypeNodeKind::Infer(param) => checker.check_id(param),
        TypeNodeKind::Mapped(mapped) => checker.check_id(mapped),
        TypeNodeKind::IndexedAccess { obj, index } => checker.check_ids([obj, index]),
        TypeNodeKind::Typeof {
            name, args, expr, ..
        } => {
            checker.check_span(name)?;
            checker.check_list(args)?;
            checker.check_id(expr)
        }
    }
}

fn check_pat(checker: RangeChecker<'_, '_>, pat: &Pat) -> CheckResult {
    match pat.kind {
        PatKind::Missing | PatKind::Ident(_) => Ok(()),
        PatKind::Object(props) => checker.check_span(props),
        PatKind::Array(elements) => checker.check_span(elements),
    }
}

fn check_pat_prop(checker: RangeChecker<'_, '_>, prop: &PatProp) -> CheckResult {
    checker.check_key(prop.key)?;
    checker.check_optional_id(prop.value)?;
    checker.check_optional_id(prop.default)
}

fn check_pat_elem(checker: RangeChecker<'_, '_>, element: &PatElem) -> CheckResult {
    checker.check_optional_id(element.pat)?;
    checker.check_optional_id(element.default)
}

fn check_param(checker: RangeChecker<'_, '_>, param: &Param) -> CheckResult {
    checker.check_optional_id(param.pat)?;
    checker.check_optional_id(param.ty)?;
    checker.check_optional_id(param.default)
}

fn check_modifier_list(checker: RangeChecker<'_, '_>, modifiers: &Span<ModifierId>) -> CheckResult {
    checker.check_span(*modifiers)
}

fn check_type_param(checker: RangeChecker<'_, '_>, param: &TypeParam) -> CheckResult {
    checker.check_optional_id(param.constraint)?;
    checker.check_optional_id(param.default)?;
    checker.check_span(param.modifiers)
}

fn check_member(checker: RangeChecker<'_, '_>, member: &Member) -> CheckResult {
    checker.check_key(member.key)?;
    checker.check_optional_id(member.ty)?;
    checker.check_optional_id(member.init)?;
    checker.check_optional_id(member.func)?;
    checker.check_span(member.modifiers)
}

fn check_prop(checker: RangeChecker<'_, '_>, prop: &Prop) -> CheckResult {
    checker.check_key(prop.key)?;
    checker.check_optional_id(prop.value)
}

fn check_var_decl(checker: RangeChecker<'_, '_>, decl: &VarDecl) -> CheckResult {
    checker.check_optional_id(decl.pat)?;
    checker.check_optional_id(decl.ty)?;
    checker.check_optional_id(decl.init)
}

fn check_case(checker: RangeChecker<'_, '_>, case: &Case) -> CheckResult {
    checker.check_optional_id(case.test)?;
    checker.check_list(case.body)
}

fn check_enum_member(checker: RangeChecker<'_, '_>, member: &EnumMember) -> CheckResult {
    checker.check_optional_id(member.computed_name)?;
    checker.check_optional_id(member.init)
}

fn check_import_spec(checker: RangeChecker<'_, '_>, spec: &ImportSpec) -> CheckResult {
    checker.check_optional_id(spec.import)
}

fn check_export_spec(checker: RangeChecker<'_, '_>, spec: &ExportSpec) -> CheckResult {
    checker.check_optional_id(spec.export)
}

fn check_tuple_elem(checker: RangeChecker<'_, '_>, element: &TupleElem) -> CheckResult {
    checker.check_optional_id(element.ty)?;
    checker.check_optional_id(element.written)
}

fn check_modifier(checker: RangeChecker<'_, '_>, modifier: &Modifier) -> CheckResult {
    match modifier.kind {
        ModifierKind::Keyword(_) => Ok(()),
        ModifierKind::Decorator(expr) => checker.check_id(expr),
    }
}

fn check_function(checker: RangeChecker<'_, '_>, function: &Func) -> CheckResult {
    checker.check_span(function.type_params)?;
    checker.check_span(function.params)?;
    checker.check_optional_id(function.this_param)?;
    checker.check_optional_id(function.ret)?;
    match function.body {
        FnBody::None => Ok(()),
        FnBody::Block(list) => checker.check_list(list),
        FnBody::Expr(expr) => checker.check_id(expr),
    }
}

fn check_class(checker: RangeChecker<'_, '_>, class: &Class) -> CheckResult {
    checker.check_span(class.type_params)?;
    checker.check_optional_id(class.extends)?;
    checker.check_list(class.extends_args)?;
    checker.check_list(class.other_extends)?;
    checker.check_list(class.implements)?;
    checker.check_list(class.other_implements)?;
    checker.check_span(class.members)?;
    checker.check_span(class.modifiers)
}

fn check_call(checker: RangeChecker<'_, '_>, call: &Call) -> CheckResult {
    checker.check_optional_id(call.callee)?;
    checker.check_list(call.args)?;
    checker.check_list_at(call.type_args)
}

fn check_jsx(checker: RangeChecker<'_, '_>, jsx: &Jsx) -> CheckResult {
    checker.check_optional_id(jsx.tag)?;
    checker.check_optional_id(jsx.close_tag)?;
    checker.check_span(jsx.attrs)?;
    checker.check_list(jsx.children)?;
    checker.check_list(jsx.type_args)
}

fn check_import(checker: RangeChecker<'_, '_>, import: &Import) -> CheckResult {
    checker.check_span(import.named)?;
    checker.check_optional_id(import.attributes)?;
    checker.check_optional_id(import.stmt)
}

fn check_export(checker: RangeChecker<'_, '_>, export: &Export) -> CheckResult {
    checker.check_span(export.items)?;
    checker.check_optional_id(export.attributes)?;
    checker.check_optional_id(export.stmt)
}

fn check_interface(checker: RangeChecker<'_, '_>, interface: &Interface) -> CheckResult {
    checker.check_span(interface.type_params)?;
    checker.check_list(interface.extends)?;
    checker.check_list(interface.other_heritage)?;
    checker.check_span(interface.members)?;
    checker.check_optional_id(interface.stmt)
}

fn check_alias(checker: RangeChecker<'_, '_>, alias: &Alias) -> CheckResult {
    checker.check_span(alias.type_params)?;
    checker.check_optional_id(alias.ty)?;
    checker.check_optional_id(alias.stmt)
}

fn check_enum(checker: RangeChecker<'_, '_>, enumeration: &Enum) -> CheckResult {
    checker.check_span(enumeration.members)?;
    checker.check_optional_id(enumeration.stmt)
}

fn check_module(checker: RangeChecker<'_, '_>, module: &Module) -> CheckResult {
    checker.check_list(module.body)?;
    checker.check_optional_id(module.stmt)
}

fn check_import_equals(checker: RangeChecker<'_, '_>, import: &ImportEquals) -> CheckResult {
    match import.target {
        ImportEqualsTarget::Require(_) => {}
        ImportEqualsTarget::Entity(name) => checker.check_span(name)?,
    }
    checker.check_optional_id(import.expression)?;
    checker.check_optional_id(import.stmt)
}

fn check_mapped(checker: RangeChecker<'_, '_>, mapped: &Mapped) -> CheckResult {
    checker.check_optional_id(mapped.param)?;
    checker.check_optional_id(mapped.name_ty)?;
    checker.check_optional_id(mapped.ty)?;
    checker.check_span(mapped.members)
}
