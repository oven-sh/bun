use super::{
    CallTarget, CheckedType, ClassDeclaration, ClassParent, ClassRef, ClassShape, FunctionRef,
    GaveUp, ObjectMemberKind, ObjectOrigin, Queries, ShapeKind, TypeArgument, TypeIdentity,
    WrittenType,
};
use crate::atom::{Atom, written_name};
use crate::bind::{Bound, ClassOwner, FnOwner, PatParent, ScopeId, SymbolId};
use crate::check::spans::{compute_ecma_line_starts, skip_trivia};
use crate::hir::{
    self, ClassId, EnumMemberId, ExprId, ExprKind, FnId, PatId, PatKind, PropId, PropKey, PropKind,
    Span, TypeNodeId, end_of_expr, start_of,
};
use crate::program::{FileId, FileRole, Sym};
use crate::types::{SigId, TypeId};
use crate::util::FxHashMap;
use notation::{bool_text, gave_up_text, identity_text, primitives_text};

mod notation;

const MAX_SUBJECT_BYTES: usize = 40;

type Answer = Result<Vec<u8>, GaveUp>;

pub fn write_queries(queries: &mut Queries<'_, '_, '_>, root: &[u8], out: &mut Vec<u8>) {
    let mut writer = Writer {
        queries,
        root,
        out,
        line_starts: FxHashMap::default(),
    };
    writer.write_file();
}

struct Site {
    line: u32,
    subject: Vec<u8>,
}

struct Writer<'w, 'c, 'p, 's> {
    queries: &'w mut Queries<'c, 'p, 's>,
    root: &'w [u8],
    out: &'w mut Vec<u8>,
    line_starts: FxHashMap<FileId, Vec<u32>>,
}

fn quoted(text: &[u8]) -> Vec<u8> {
    [b"`", text, b"`"].concat()
}

fn excerpt(text: &[u8]) -> Vec<u8> {
    let mut collapsed = Vec::with_capacity(text.len().min(2 * MAX_SUBJECT_BYTES));
    let mut is_after_space = false;
    for &byte in text {
        let is_space = byte.is_ascii_whitespace();
        if !is_space {
            collapsed.push(byte);
        } else if !is_after_space {
            collapsed.push(b' ');
        }
        is_after_space = is_space;
        if collapsed.len() > MAX_SUBJECT_BYTES + 4 {
            break;
        }
    }
    if collapsed.len() <= MAX_SUBJECT_BYTES {
        return collapsed;
    }
    let mut end = MAX_SUBJECT_BYTES;
    while end > 0 && collapsed[end] & 0xC0 == 0x80 {
        end -= 1;
    }
    collapsed.truncate(end);
    collapsed.extend_from_slice(b"...");
    collapsed
}

fn line_number(line_starts: &[u32], position: u32) -> u32 {
    line_starts.partition_point(|&start| start <= position) as u32
}

impl<'c, 'p, 's> Writer<'_, 'c, 'p, 's> {
    fn hir(&self) -> &'p hir::File<'s> {
        self.queries.hir()
    }

    fn bound(&self) -> &'p Bound<'s> {
        self.queries.bound()
    }

    fn write_file(&mut self) {
        self.write_role_and_options(self.queries.file());
        self.write_declaration_file_options();
        if self.bound().ran_out_of_stack {
            return;
        }
        let (hir, bound) = (self.hir(), self.bound());
        for expression in (0..hir.exprs.len() as u32).map(ExprId) {
            self.write_expression(expression);
        }
        for node in (0..hir.types.len() as u32).map(TypeNodeId) {
            if bound.type_scope[node.idx()] != ScopeId::NONE {
                self.write_type_node(node);
            }
        }
        self.write_parameters();
        self.write_bindings();
        self.write_functions();
        self.write_classes();
        self.write_enum_members();
    }

    fn emit(&mut self, site: &Site, query: &[u8], answer: Answer) {
        self.emit_for_file(self.queries.file(), site, query, answer);
    }

    fn emit_type(&mut self, site: &Site, query: &[u8], ty: CheckedType) {
        let answer = ty.map(|ty| self.queries.type_text(ty));
        self.emit(site, query, answer);
    }

    fn emit_for_file(&mut self, file: FileId, site: &Site, query: &[u8], answer: Answer) {
        let path = self.relative_path(file);
        let answer = answer.unwrap_or_else(gave_up_text);
        let position = format!(":{} ", site.line);
        let parts: [&[u8]; 8] = [
            path,
            position.as_bytes(),
            query,
            b" ",
            &site.subject,
            b" = ",
            &answer,
            b"\n",
        ];
        self.out.extend_from_slice(&parts.concat());
    }

    fn relative_path(&self, file: FileId) -> &'s [u8] {
        let name = self.queries.files().module(file).file_name();
        name.strip_prefix(self.root).unwrap_or(name)
    }

    fn line_of(&mut self, file: FileId, position: u32) -> u32 {
        let text = &self.queries.files().hir(file).text[..];
        let line_starts = self.line_starts.entry(file);
        line_number(
            line_starts.or_insert_with(|| compute_ecma_line_starts(text)),
            position,
        )
    }

    fn is_under_root(&self, file: FileId) -> bool {
        let name = self.queries.files().module(file).file_name();
        name.starts_with(self.root)
    }

    fn location(&mut self, file: FileId, position: impl FnOnce(&hir::File<'s>) -> u32) -> Vec<u8> {
        let files = self.queries.files();
        if !self.is_under_root(file) {
            return b"outside".to_vec();
        }
        let line = self.line_of(file, position(files.hir(file)));
        [self.relative_path(file), format!(":{line}").as_bytes()].concat()
    }

    fn class_location(&mut self, class: ClassRef) -> Vec<u8> {
        self.location(class.file, |hir| hir[class.class].start)
    }

    fn function_location(&mut self, function: FunctionRef) -> Vec<u8> {
        self.location(function.file, |hir| hir[function.function].start)
    }

    fn declaration_location(&mut self, declaration: ClassDeclaration) -> Vec<u8> {
        match declaration {
            ClassDeclaration::Class(class) => self.class_location(class),
            ClassDeclaration::Function(function) => self.function_location(function),
        }
    }

    fn parent_location(&mut self, parent: ClassParent) -> Vec<u8> {
        match parent {
            ClassParent::Declared(declaration) => self.declaration_location(declaration),
            ClassParent::Library(_) => b"in the library".to_vec(),
        }
    }

    fn site(&mut self, start: u32, end: u32, name: Option<&[u8]>) -> Site {
        let text = &self.hir().text[..];
        let start = skip_trivia(text, (start as usize).min(text.len()));
        let subject = match name {
            Some(name) => quoted(name),
            None => quoted(&excerpt(text.get(start..end as usize).unwrap_or_default())),
        };
        let line = self.line_of(self.queries.file(), start as u32);
        Site { line, subject }
    }

    fn function_name(&self, function: FnId) -> Option<&'p [u8]> {
        let hir = self.hir();
        let mut name = hir[function].name;
        if let FnOwner::Member(member) = self.bound().fns[function.idx()].owner
            && name.is_none()
        {
            name = hir[member].key.name().unwrap_or(Atom::NONE);
        }
        name.is_some()
            .then(|| written_name(self.queries.atom_bytes(name)))
    }

    fn class_name(&self, class: ClassId) -> Option<&'p [u8]> {
        let name = self.hir()[class].name;
        name.is_some().then(|| self.queries.atom_bytes(name))
    }

    fn expression_site(&mut self, expression: ExprId) -> Site {
        let hir = self.hir();
        let kind = hir[expression].kind;
        let name = if let ExprKind::Fn(function) = kind {
            self.function_name(function)
        } else if let ExprKind::Class(class) = kind {
            self.class_name(class)
        } else {
            None
        };
        self.site(
            start_of(hir, expression),
            end_of_expr(hir, expression),
            name,
        )
    }

    fn type_node_site(&mut self, node: TypeNodeId) -> Site {
        let type_node = &self.hir()[node];
        self.site(type_node.pos, type_node.end, None)
    }

    fn function_site(&mut self, function: FnId) -> Site {
        let hir = self.hir();
        let end = match self.bound().fns[function.idx()].owner {
            FnOwner::None => hir[function].start,
            FnOwner::Expr(expression) => end_of_expr(hir, expression),
            FnOwner::Stmt(statement) => hir[statement].loc.end,
            FnOwner::Member(member) => hir[member].loc.end,
            FnOwner::Type(node) => hir[node].end,
        };
        let name = self.function_name(function);
        self.site(hir[function].start, end, name)
    }

    fn class_site(&mut self, class: ClassId) -> Site {
        let hir = self.hir();
        let end = match self.bound().class_owner[class.idx()] {
            ClassOwner::Expr(expression) => end_of_expr(hir, expression),
            ClassOwner::Stmt(statement) => hir[statement].loc.end,
        };
        let name = self.class_name(class);
        self.site(hir[class].start, end, name)
    }

    fn write_role_and_options(&mut self, file: FileId) {
        let site = Site {
            line: 0,
            subject: quoted(b""),
        };
        let role = format!("{:?}", self.queries.role(file)).into_bytes();
        self.emit_for_file(file, &site, b"role", Ok(role));
        let options = self.queries.c.module_options(file);
        let lines: [(&[u8], bool); 7] = [
            (
                b"option verbatimModuleSyntax",
                options.verbatim_module_syntax,
            ),
            (b"option isolatedModules", options.isolated_modules),
            (
                b"option allowSyntheticDefaultImports",
                !options.forbids_synthetic_default_imports,
            ),
            (b"option erasableSyntaxOnly", options.erasable_syntax_only),
            (b"option noImplicitAny", options.no_implicit_any),
            (
                b"option useUnknownInCatchVariables",
                options.use_unknown_in_catch_variables,
            ),
            (
                b"option strictPropertyInitialization",
                options.strict_property_initialization,
            ),
        ];
        for (query, value) in lines {
            self.emit_for_file(file, &site, query, Ok(bool_text(value)));
        }
    }

    fn is_first_compiled_importer(&self, target: FileId) -> bool {
        let files = self.queries.files();
        let mut importers = files.compiled_files().iter();
        let first = importers.find(|&&importer| files.module(importer).edges.contains(&target));
        first == Some(&self.queries.file())
    }

    fn write_declaration_file_options(&mut self) {
        let files = self.queries.files();
        let edges = files.module(self.queries.file()).edges;
        for (index, &target) in edges.iter().enumerate() {
            let is_declaration_file = match self.queries.role(target) {
                FileRole::TypesOnly => true,
                FileRole::Checked | FileRole::Inferred => false,
            };
            if is_declaration_file
                && !edges[..index].contains(&target)
                && self.is_under_root(target)
                && self.is_first_compiled_importer(target)
            {
                self.write_role_and_options(target);
            }
        }
    }

    fn write_contextual_type(&mut self, site: &Site, expression: ExprId) {
        let ty = self.queries.contextual_type(expression);
        let answer = ty.map(|ty| self.optional_type_text(ty));
        self.emit(site, b"contextual", answer);
    }

    fn write_member_access(&mut self, site: &Site, access: ExprId) {
        let lookup = self.queries.member_access(access);
        let answer = lookup.map(|lookup| self.member_lookup_text(lookup));
        self.emit(site, b"member", answer);
        let answer = match self.queries.constant_enum_access(access) {
            Ok(None) => return,
            Ok(Some(value)) => Ok(self.enum_value_text(value)),
            Err(reason) => Err(reason),
        };
        self.emit(site, b"enum", answer);
    }

    fn write_call_target(&mut self, site: &Site, target: CallTarget) {
        let declaration = match target.declaration {
            Some(function) => self.function_location(function),
            None => b"none".to_vec(),
        };
        self.emit(
            site,
            b"call",
            Ok([b"declaration ", &declaration[..]].concat()),
        );
        let result = self.position_text(target.result);
        self.emit(site, b"call result", Ok(result));
        let signature = self.queries.signature(target.signature);
        let answer = self.signature_text(&signature);
        self.emit(site, b"call signature", Ok(answer));
    }

    fn write_type_arguments(
        &mut self,
        site: &Site,
        query: &[u8],
        arguments: Result<&[TypeArgument], GaveUp>,
    ) {
        match arguments {
            Ok(arguments) => {
                for &pair in arguments {
                    let text = self.type_argument_text(pair);
                    self.emit(site, query, Ok(text));
                }
            }
            Err(reason) => self.emit(site, query, Err(reason)),
        }
    }

    fn write_call(&mut self, site: &Site, call: ExprId) {
        match self.queries.resolved_call(call) {
            Ok(Some(target)) => self.write_call_target(site, target),
            Ok(None) => self.emit(site, b"call", Ok(b"none".to_vec())),
            Err(reason) => self.emit(site, b"call", Err(reason)),
        }
        let arguments = self.queries.call_type_arguments(call);
        self.write_type_arguments(site, b"call type argument", arguments);
    }

    fn untyped_member(&self, property: PropId) -> Option<(&'p [u8], ObjectMemberKind)> {
        let hir = self.hir();
        let name = match hir[property].key {
            PropKey::Name(name) => name,
            PropKey::None | PropKey::Private(_) | PropKey::Computed(_) => return None,
        };
        let kind = match hir[property].kind {
            PropKind::Init | PropKind::Shorthand => ObjectMemberKind::Field,
            PropKind::Method => ObjectMemberKind::Method,
            PropKind::Getter => ObjectMemberKind::Getter,
            PropKind::Setter => ObjectMemberKind::Setter,
            PropKind::Spread => return None,
        };
        Some((self.queries.atom_bytes(name), kind))
    }

    fn untyped_identity(&self, properties: Span<PropId>) -> Option<TypeIdentity> {
        let members = properties
            .iter()
            .map(|property| self.untyped_member(property));
        let members: Vec<(&'p [u8], ObjectMemberKind)> = members.collect::<Option<_>>()?;
        Some(TypeIdentity::of_untyped_members(members.into_iter()))
    }

    fn write_literal_identities(&mut self, site: &Site, literal: ExprId, properties: Span<PropId>) {
        let ty = self.queries.expression_type(literal);
        let identity = ty.and_then(|ty| self.queries.type_identity(ty));
        self.emit(site, b"identity", identity.map(identity_text));
        if let Some(identity) = self.untyped_identity(properties) {
            self.emit(site, b"untyped identity", Ok(identity_text(identity)));
        }
    }

    fn write_result_identity(&mut self, site: &Site, ty: CheckedType) {
        let Ok(ty) = ty else {
            return;
        };
        if matches!(self.queries.type_shape(ty), Ok(shape) if shape.kind == ShapeKind::Object) {
            let origin = self.origin_text(ty);
            self.emit(site, b"origin", Ok(origin));
        }
        let identity = self.queries.type_identity(ty);
        self.emit(site, b"identity", identity.map(identity_text));
    }

    fn write_expression(&mut self, expression: ExprId) {
        let site = self.expression_site(expression);
        let ty = self.queries.expression_type(expression);
        self.emit_type(&site, b"type", ty);
        let predicted = self.queries.predicted_expression_type(expression);
        if predicted != ty {
            self.emit_type(&site, b"predicted", predicted);
        }
        let kind = self.hir()[expression].kind;
        match kind {
            ExprKind::Object(properties) => {
                self.write_contextual_type(&site, expression);
                self.write_literal_identities(&site, expression, properties);
            }
            ExprKind::Array(_) | ExprKind::Fn(_) | ExprKind::Number(_) | ExprKind::String(_) => {
                self.write_contextual_type(&site, expression);
            }
            ExprKind::Dot { .. } | ExprKind::Index { .. } => {
                self.write_member_access(&site, expression);
            }
            ExprKind::Call(_) | ExprKind::New(_) | ExprKind::TaggedTemplate(_) => {
                self.write_call(&site, expression);
                self.write_result_identity(&site, ty);
            }
            ExprKind::Missing
            | ExprKind::Ident(_)
            | ExprKind::PrivateIdentifier(_)
            | ExprKind::This
            | ExprKind::Super
            | ExprKind::Null
            | ExprKind::True
            | ExprKind::False
            | ExprKind::BigInt(_)
            | ExprKind::Regex { .. }
            | ExprKind::Template { .. }
            | ExprKind::Class(_)
            | ExprKind::Unary { .. }
            | ExprKind::Binary { .. }
            | ExprKind::Assign { .. }
            | ExprKind::Cond { .. }
            | ExprKind::Spread(_)
            | ExprKind::Await(_)
            | ExprKind::Yield { .. }
            | ExprKind::As { .. }
            | ExprKind::Satisfies { .. }
            | ExprKind::AsConst(_)
            | ExprKind::NonNull(_)
            | ExprKind::Instantiation { .. }
            | ExprKind::Jsx(_)
            | ExprKind::ImportCall { .. }
            | ExprKind::ImportMeta
            | ExprKind::NewTarget(_)
            | ExprKind::JsxText(_) => {}
        }
    }

    fn symbol_origin_text(&mut self, symbol: Sym) -> Vec<u8> {
        let files = self.queries.files();
        let name = self.queries.atom_bytes(files.symbol(symbol).name);
        let first_declaration = files.decls_of(symbol).first().copied();
        let location = match first_declaration {
            Some((file, declaration)) => {
                self.location(file, |hir| hir.start(hir.node(declaration)))
            }
            None => b"outside".to_vec(),
        };
        [b"symbol ", name, b" ", &location[..]].concat()
    }

    fn origin_text(&mut self, object_type: TypeId) -> Vec<u8> {
        match self.queries.object_origin(object_type) {
            ObjectOrigin::Symbol(symbol) => self.symbol_origin_text(symbol),
            ObjectOrigin::TypeLiteral { file, node } => {
                let location = self.location(file, |hir| hir[node].pos);
                [b"type literal ", &location[..]].concat()
            }
            ObjectOrigin::MappedType { file, node } => {
                let location = self.location(file, |hir| hir[node].pos);
                [b"mapped type ", &location[..]].concat()
            }
            ObjectOrigin::ObjectLiteral { file, expression } => {
                let location = self.location(file, |hir| start_of(hir, expression));
                [b"object literal ", &location[..]].concat()
            }
            ObjectOrigin::Computed => b"computed".to_vec(),
        }
    }

    fn write_declared_class(&mut self, site: &Site, found: ClassRef) {
        let shape = self.queries.class_shape(found);
        for member in shape.members {
            let text = self.class_member_text(found.file, member);
            self.emit(site, b"declares", Ok(text));
        }
    }

    fn write_accepted_primitives(&mut self, site: &Site, object_type: TypeId) {
        let primitives = self.queries.accepted_primitives(object_type);
        self.emit(site, b"primitives", primitives.map(primitives_text));
    }

    fn write_awaited_type(&mut self, site: &Site, ty: TypeId) {
        let awaited = self.queries.awaited_type(ty);
        self.emit_type(site, b"awaited", awaited);
    }

    fn write_first_overload(&mut self, site: &Site, signatures: &[SigId]) {
        let answer = match self.queries.first_overload(signatures) {
            Some(function) => self.function_location(function),
            None => b"none".to_vec(),
        };
        self.emit(site, b"first overload", Ok(answer));
    }

    fn write_queries_by_shape(&mut self, site: &Site, ty: TypeId, kind: ShapeKind<'_>) {
        match kind {
            ShapeKind::Object => {
                let origin = self.origin_text(ty);
                self.emit(site, b"origin", Ok(origin));
                self.write_type_members(site, ty);
                self.write_accepted_primitives(site, ty);
            }
            ShapeKind::Class(found) => {
                self.write_type_members(site, ty);
                self.write_declared_class(site, found);
                self.write_accepted_primitives(site, ty);
                let arguments = self.queries.class_type_arguments(found, ty);
                self.write_type_arguments(site, b"class type argument", arguments);
            }
            ShapeKind::Builtin { .. } => {
                self.write_accepted_primitives(site, ty);
                self.write_awaited_type(site, ty);
            }
            ShapeKind::Union(_) => self.write_awaited_type(site, ty),
            ShapeKind::Function(signatures) => self.write_first_overload(site, signatures),
            ShapeKind::Anything(_)
            | ShapeKind::TypeVariable { .. }
            | ShapeKind::Never
            | ShapeKind::Undefined
            | ShapeKind::Null
            | ShapeKind::Boolean
            | ShapeKind::BooleanLiteral(_)
            | ShapeKind::Number
            | ShapeKind::NumberLiteral(_)
            | ShapeKind::NumericEnumMember(_)
            | ShapeKind::BigInt
            | ShapeKind::BigIntLiteral { .. }
            | ShapeKind::String
            | ShapeKind::StringLiteral(_)
            | ShapeKind::TemplateLiteral { .. }
            | ShapeKind::Symbol
            | ShapeKind::AnyObject
            | ShapeKind::ClassConstructor(_)
            | ShapeKind::Array { .. }
            | ShapeKind::Tuple { .. }
            | ShapeKind::Int32 { .. } => {}
        }
    }

    fn write_type_node(&mut self, node: TypeNodeId) {
        let site = self.type_node_site(node);
        let written = self.queries.written_type(node);
        let answer = self.written_text(written);
        self.emit(&site, b"written", Ok(answer));
        let ty = match written {
            WrittenType::Written(ty) => ty,
            WrittenType::Unwritten | WrittenType::GaveUp(_) => return,
        };
        let shape = self.queries.type_shape(ty);
        let answer = shape.map(|shape| self.shape_text(shape));
        self.emit(&site, b"shape", answer);
        let identity = self.queries.type_identity(ty);
        self.emit(&site, b"identity", identity.map(identity_text));
        if let Ok(shape) = shape {
            self.write_queries_by_shape(&site, ty, shape.kind);
        }
    }

    fn write_type_members(&mut self, site: &Site, ty: TypeId) {
        match self.queries.object_members(ty) {
            Ok(members) => {
                for member in members {
                    let text = self.object_member_text(member);
                    self.emit(site, b"has", Ok(text));
                }
            }
            Err(reason) => self.emit(site, b"has", Err(reason)),
        }
        match self.queries.index_signatures(ty) {
            Ok(signatures) => {
                for signature in signatures {
                    let text = self.index_signature_text(signature);
                    self.emit(site, b"index", Ok(text));
                }
            }
            Err(reason) => self.emit(site, b"index", Err(reason)),
        }
    }

    fn write_parameters(&mut self) {
        let (hir, bound) = (self.hir(), self.bound());
        for parameter in (0..hir.params.len() as u32).map(hir::ParamId) {
            if bound.param_fn[parameter.idx()] == FnId::NONE {
                continue;
            }
            let node = &hir[parameter];
            let end = match node.loc.end {
                0 => hir[node.pat].end,
                end => end,
            };
            let site = self.site(node.pos, end, None);
            let ty = self.queries.parameter_type(parameter);
            self.emit_type(&site, b"parameter", ty);
        }
    }

    fn write_bindings(&mut self) {
        let (hir, bound) = (self.hir(), self.bound());
        for pattern in (0..hir.pats.len() as u32).map(PatId) {
            let is_bound = !matches!(bound.pat_parent[pattern.idx()], PatParent::None)
                && bound.pat_symbol[pattern.idx()] != SymbolId::NONE;
            if !is_bound || !matches!(hir[pattern].kind, PatKind::Ident(_)) {
                continue;
            }
            let site = self.site(hir[pattern].pos, hir[pattern].end, None);
            let ty = self.queries.binding_type(pattern);
            self.emit_type(&site, b"binding", ty);
            let symbol = self
                .queries
                .canonical_symbol(self.queries.file(), bound.pat_symbol[pattern.idx()]);
            let written = self.queries.written_variable_type(symbol);
            let answer = self.written_text(written);
            self.emit(&site, b"variable", Ok(answer));
        }
    }

    fn write_class_shape(&mut self, site: &Site, query: &[u8], shape: &ClassShape<'_>) {
        let header = format!(
            "computed instance {} computed static {}",
            shape.has_computed_instance_name, shape.has_computed_static_name
        );
        self.emit(site, query, Ok(header.into_bytes()));
        let member_query = [query, b" member"].concat();
        let file = shape.declaration.file();
        for member in shape.members {
            let text = self.class_member_text(file, member);
            self.emit(site, &member_query, Ok(text));
        }
    }

    fn write_functions(&mut self) {
        let (hir, bound) = (self.hir(), self.bound());
        let file = self.queries.file();
        for function in (0..hir.fns.len() as u32).map(FnId) {
            if matches!(bound.fns[function.idx()].owner, FnOwner::None) {
                continue;
            }
            let site = self.function_site(function);
            let ty = self.queries.return_type(function);
            self.emit_type(&site, b"returns", ty);
            let function = FunctionRef { file, function };
            let signature = self.queries.function_signature(function);
            let answer = self.signature_text(&signature);
            self.emit(&site, b"signature", Ok(answer));
            if let Some(implementation) = self.queries.overload_implementation(function) {
                let location = self.function_location(implementation);
                self.emit(&site, b"overload implementation", Ok(location));
            }
            if let Some(shape) = self.queries.constructor_function_shape(function) {
                self.write_class_shape(&site, b"constructor function", shape);
            }
            if let Some(parent) = self.queries.constructor_function_parent(function) {
                let location = self.parent_location(parent);
                self.emit(&site, b"constructor function parent", Ok(location));
            }
        }
    }

    fn has_class_binding(&self, class: ClassId) -> bool {
        let symbol = self.bound().class_symbol[class.idx()];
        if symbol == SymbolId::NONE {
            return false;
        }
        let symbol = self.queries.canonical_symbol(self.queries.file(), symbol);
        self.queries.class_of_binding(symbol).is_some()
    }

    fn write_classes(&mut self) {
        let (hir, bound) = (self.hir(), self.bound());
        let file = self.queries.file();
        for class in (0..hir.classes.len() as u32).map(ClassId) {
            if bound.class_scope[class.idx()] == ScopeId::NONE {
                continue;
            }
            let site = self.class_site(class);
            let shape = self.queries.class_shape(ClassRef { file, class });
            self.write_class_shape(&site, b"class", shape);
            let binding: &[u8] = if self.has_class_binding(class) {
                b"yes"
            } else {
                b"no"
            };
            self.emit(&site, b"class binding", Ok(binding.to_vec()));
        }
    }

    fn write_enum_members(&mut self) {
        let (hir, bound) = (self.hir(), self.bound());
        for member in (0..hir.enum_members.len() as u32).map(EnumMemberId) {
            if bound.enum_member_owner[member.idx()] == hir::EnumId::NONE {
                continue;
            }
            let site = self.site(hir[member].pos, hir[member].loc.end, None);
            let value = self.queries.enum_member_value(member);
            let answer = value.map(|value| match value {
                Some(constant) => self.enum_constant_text(constant),
                None => b"none".to_vec(),
            });
            self.emit(&site, b"enum member", answer);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn excerpt_collapses_white_space() {
        assert_eq!(excerpt(b"a \t\r\n  b\n\nc"), b"a b c");
    }

    #[test]
    fn excerpt_cuts_at_a_character_boundary() {
        let exact = [b'a'; MAX_SUBJECT_BYTES];
        assert_eq!(excerpt(&exact), exact);
        let long = [b'a'; MAX_SUBJECT_BYTES + 1];
        assert_eq!(excerpt(&long), [&exact[..], b"..."].concat());
        let mut split = vec![b'a'; MAX_SUBJECT_BYTES - 1];
        split.extend_from_slice("é".as_bytes());
        assert_eq!(
            excerpt(&split),
            [&exact[..MAX_SUBJECT_BYTES - 1], b"..."].concat()
        );
    }

    #[test]
    fn line_of_first_and_last_byte() {
        let line_starts = compute_ecma_line_starts(b"ab\ncd\n");
        assert_eq!(line_number(&line_starts, 0), 1);
        assert_eq!(line_number(&line_starts, 2), 1);
        assert_eq!(line_number(&line_starts, 3), 2);
        assert_eq!(line_number(&line_starts, 4), 2);
        assert_eq!(line_number(&line_starts, 6), 3);
    }
}
