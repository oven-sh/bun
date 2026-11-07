use super::summary::{StoredName, SummaryWalk, names_exports_of_inner_module};
use crate::builtins::id::BuiltinId;
use crate::builtins::{Mutability, Resolved, ResolvedBuiltins};
use crate::known_helpers::{Helper, KnownFunction, KnownHelpers, Shape};
use crate::load::sources::parsed_source;
use crate::modules::order::FileText;
use crate::modules::{BindInput, DescribedPart, InnerModule, WrappedModules, WrittenDescriptor};
use bun_sema::atom::{Atom, known};
use bun_sema::bind::{
    Binding, BindingInitializer, Bound, CommonJsVariable, FnOwner, Parent, SymbolId,
};
use bun_sema::file_analysis::FileAnalysis;
use bun_sema::fold::{Constant, FoldedValue};
use bun_sema::hir::{
    self, Chain, ExprId, ExprKind, FnKind, PropId, PropKey, PropKind, Span, StmtId, StmtKind,
};
use bun_sema::import_sites::ImportSiteKind;
use bun_sema::program::{FileId, Files};
use bun_sema::util::SharedSort;
use smallvec::SmallVec;

type Arguments = SmallVec<[ExprId; 4]>;

struct CallReader<'a, 's> {
    files: &'a Files<'s>,
    file: FileId,
    hir: &'a hir::File<'s>,
    bound: &'a Bound<'s>,
    analysis: &'a FileAnalysis<'s>,
    builtins: &'a ResolvedBuiltins,
    bind: &'a BindInput<'a, 's>,
    helpers: &'a KnownHelpers,
    wrapped: &'a WrappedModules,
    inner: Option<&'a InnerModule>,
    statement: StmtId,
    names: &'a mut Vec<StoredName>,
    marker: &'a mut Option<bool>,
}

impl SummaryWalk<'_, '_, '_> {
    pub(super) fn look_at_call(&mut self, statement: StmtId, call: ExprId) -> bool {
        let (bind, file) = (self.input.bind, self.file);
        if self.summary.object_escapes {
            return false;
        }
        let Some(source) = parsed_source(bind.files, file) else {
            return false;
        };
        let (count, marker) = (self.summary.names.len(), self.summary.marker);
        let mut reader = CallReader {
            files: bind.files,
            file,
            hir: bind.files.hir(file),
            bound: bind.files.bound(file),
            analysis: bind.files.analysis(file),
            builtins: &source.builtins,
            bind,
            helpers: bind.known_helpers,
            wrapped: &self.input.modules.wrapped,
            inner: self.inner,
            statement,
            names: &mut self.summary.names,
            marker: &mut self.summary.marker,
        };
        let is_understood = reader.read_call(call).is_some();
        if !is_understood {
            self.summary.names.truncate(count);
            self.summary.marker = marker;
        }
        is_understood
    }
}

impl<'a> CallReader<'a, '_> {
    fn read_call(&mut self, node: ExprId) -> Option<()> {
        let (callee, arguments) = self.find_plain_call(node)?;
        if self.find_expression_statement(node) != Some(self.statement) {
            return self.read_to_common_js(node, callee, &arguments);
        }
        if let Some(builtin) = self.find_locked_builtin(callee) {
            return match builtin {
                BuiltinId::ObjectDefineProperty | BuiltinId::ReflectDefineProperty => {
                    self.read_define_property(&arguments)
                }
                BuiltinId::ObjectAssign => self.read_object_assign(&arguments),
                _ => None,
            };
        }
        let known = self.find_helper(callee)?;
        match known.shape.helper() {
            Helper::Export => self.read_export(known.shape, &arguments),
            Helper::ExportStar => self.read_export_star(&arguments),
            Helper::ReExport => self.read_re_export(&arguments),
            Helper::CreateBinding => self.read_create_binding(known, &arguments),
            Helper::MarkAsModule => self.read_mark_as_module(&arguments),
            Helper::ClassPrivateFieldGet
            | Helper::ClassPrivateFieldSet
            | Helper::ClassPrivateFieldIn
            | Helper::ExportSetter
            | Helper::ReturnValue
            | Helper::CommonJs
            | Helper::Esm
            | Helper::Require
            | Helper::DefineProperties
            | Helper::CreateClass
            | Helper::ToPropertyKey
            | Helper::ToPrimitive
            | Helper::Typeof
            | Helper::CopyProperties
            | Helper::ToCommonJs
            | Helper::ToEsModule
            | Helper::SetModuleDefault
            | Helper::ImportStar
            | Helper::ImportDefault => None,
        }
    }

    fn parent(&self, expression: ExprId) -> (ExprId, Parent) {
        let mut outermost = expression;
        loop {
            match self.bound.parent_of_expr(outermost) {
                Parent::Expr(user) if self.hir.type_assertion_operand(user) == Some(outermost) => {
                    outermost = user;
                }
                parent => return (outermost, parent),
            }
        }
    }

    fn find_expression_statement(&self, expression: ExprId) -> Option<StmtId> {
        match self.parent(expression).1 {
            Parent::Stmt(holder)
                if holder.is_some() && matches!(self.hir[holder].kind, StmtKind::Expr(_)) =>
            {
                Some(holder)
            }
            _ => None,
        }
    }

    fn is_top_level_statement(&self, expression: ExprId) -> bool {
        let statement = self.find_expression_statement(expression);
        statement.is_some_and(|statement| self.bound.parent_of_stmt(statement) == Parent::File)
    }

    fn find_plain_call(&self, node: ExprId) -> Option<(ExprId, Arguments)> {
        let hir = self.hir;
        let ExprKind::Call(call) = hir[node.some()?].kind else {
            return None;
        };
        let call = hir[call];
        let arguments: Arguments = hir.ids(call.args).collect();
        let mut written = arguments.iter();
        let has_spread = written.any(|&argument| matches!(hir[argument].kind, ExprKind::Spread(_)));
        (call.chain == Chain::No && !has_spread).then_some((call.callee, arguments))
    }

    fn find_locked_builtin(&self, callee: ExprId) -> Option<BuiltinId> {
        let callee = self.hir.skip_type_assertions(callee);
        match self.builtins.of_pure_expr(callee)? {
            Resolved::Builtin(path) if path.mutability == Mutability::AlwaysLocked => Some(path.id),
            Resolved::Builtin(_) | Resolved::DynamicGlobal(_) | Resolved::Intrinsic(_) => None,
        }
    }

    fn find_helper(&self, callee: ExprId) -> Option<&'a KnownFunction> {
        self.helpers.certain_callee(self.files, self.file, callee)
    }

    fn is_exports_object(&self, expression: ExprId) -> bool {
        let expression = self.hir.skip_type_assertions(expression);
        if let Some(inner) = self.inner {
            return names_exports_of_inner_module(self.hir, self.bound, inner, expression);
        }
        let is_exports_name = matches!(self.hir[expression].kind, ExprKind::Ident(_))
            && self.bound.binding(expression) == Binding::CommonJs(CommonJsVariable::Exports);
        let builtin = self.builtins.builtin_of_expression(expression);
        is_exports_name || builtin == Some(BuiltinId::ModuleObjectExports)
    }

    fn find_constant(&self, expression: ExprId) -> Option<Constant> {
        let expression = self.hir.skip_type_assertions(expression);
        match self.analysis.decisions.constant(self.hir, expression) {
            FoldedValue::Constant(constant) => Some(constant),
            FoldedValue::ConstantOutsideDeadZone(_) | FoldedValue::Unknown => None,
        }
    }

    fn is_true_constant(&self, value: ExprId) -> bool {
        self.find_constant(value) == Some(Constant::Boolean(true))
    }

    fn can_be_variable(&self, name: Atom) -> bool {
        self.bind.is_plain_name(name)
    }

    fn find_plain_name(&self, key: ExprId) -> Option<Atom> {
        match self.find_constant(key)? {
            Constant::String(name) if self.can_be_variable(name) => Some(name),
            _ => None,
        }
    }

    fn find_name_of_property(&self, property: PropId) -> Option<Atom> {
        match self.hir.runtime_property_key(property) {
            PropKey::Name(name) if self.can_be_variable(name) => Some(name),
            PropKey::Name(_) | PropKey::None | PropKey::Private(_) | PropKey::Computed(_) => None,
        }
    }

    fn is_method(&self, value: ExprId) -> bool {
        matches!(self.hir[value].kind, ExprKind::Fn(function)
            if self.hir[function].kind == FnKind::Method)
    }

    fn may_already_exist(&self, name: Atom) -> bool {
        let mut entries = self.names.iter();
        entries.any(|entry| entry.name().is_none_or(|stored| stored == name))
    }

    fn add_getter(&mut self, name: Atom, getter: ExprId, is_enumerable: bool) -> Option<()> {
        let written = self.hir.skip_type_assertions(getter);
        if !matches!(self.hir[written].kind, ExprKind::Fn(_)) {
            return None;
        }
        self.names.push(StoredName::Getter {
            name,
            statement: self.statement,
            getter,
            is_enumerable,
        });
        Some(())
    }

    fn add_getters_of_literal(&mut self, literal: ExprId) -> Option<()> {
        let hir = self.hir;
        let ExprKind::Object(properties) = hir[hir.skip_type_assertions(literal)].kind else {
            return None;
        };
        self.names.reserve(properties.len());
        for id in properties.iter() {
            let property = hir[id];
            if !matches!(property.kind, PropKind::Init | PropKind::Method) {
                return None;
            }
            let name = self.find_name_of_property(id)?;
            self.add_getter(name, property.value, true)?;
        }
        Some(())
    }

    fn add_values_of_literal(&mut self, properties: Span<PropId>) -> Option<()> {
        let hir = self.hir;
        self.names.reserve(properties.len());
        for id in properties.iter() {
            let property = hir[id];
            if !matches!(property.kind, PropKind::Init | PropKind::Shorthand) {
                return None;
            }
            let name = self.find_name_of_property(id)?;
            self.names.push(StoredName::Value {
                name,
                statement: self.statement,
                value: property.value,
            });
        }
        Some(())
    }

    fn find_site_of_require(&self, source: ExprId) -> Option<u32> {
        let hir = self.hir;
        let source = hir.skip_type_assertions(source);
        let ExprKind::Call(call) = hir[source].kind else {
            return None;
        };
        let callee = hir.skip_type_assertions(hir[call].callee);
        let text = FileText::new(self.files, self.wrapped, self.file);
        if hir[call].chain != Chain::No
            || !text.is_free(callee, CommonJsVariable::Require)
            || text.may_replace_require()
        {
            return None;
        }
        let site = self.analysis.import_site_of_call(source)?;
        let is_require = matches!(
            self.analysis.import_sites[site].kind,
            ImportSiteKind::Require(_)
        );
        is_require.then_some(site as u32)
    }

    fn add_all_of(&mut self, source: ExprId) -> Option<()> {
        let site = self.find_site_of_require(source)?;
        self.names.push(StoredName::AllOf {
            statement: self.statement,
            site,
        });
        Some(())
    }

    fn read_define_property(&mut self, arguments: &[ExprId]) -> Option<()> {
        let &[object, key, descriptor] = arguments else {
            return None;
        };
        if !self.is_exports_object(object) {
            return None;
        }
        let name = self.find_plain_name(key)?;
        let decisions = &self.analysis.decisions;
        let written = WrittenDescriptor::read(self.hir, decisions, descriptor)?;
        match written.part {
            DescribedPart::Accessor {
                getter: Some(getter),
                setter: None,
            } => {
                let is_enumerable = match written.is_enumerable {
                    Some(is_enumerable) => is_enumerable,
                    None if self.may_already_exist(name) => return None,
                    None => false,
                };
                self.add_getter(name, getter, is_enumerable)
            }
            DescribedPart::Data {
                value: Some(value), ..
            } if name == known::__esModule => {
                *self.marker = self.is_true_constant(value).then_some(true);
                Some(())
            }
            DescribedPart::Data {
                value: Some(value), ..
            } if !self.is_method(value) => {
                self.names.push(StoredName::Value {
                    name,
                    statement: self.statement,
                    value,
                });
                Some(())
            }
            DescribedPart::Data { .. } | DescribedPart::Accessor { .. } => None,
        }
    }

    fn read_object_assign(&mut self, arguments: &[ExprId]) -> Option<()> {
        let (&object, sources) = arguments.split_first()?;
        if !self.is_exports_object(object) {
            return None;
        }
        for &source in sources {
            match self.hir[self.hir.skip_type_assertions(source)].kind {
                ExprKind::Object(properties) => self.add_values_of_literal(properties)?,
                _ => {
                    self.add_all_of(source)?;
                    *self.marker = None;
                }
            }
        }
        Some(())
    }

    fn read_export(&mut self, shape: Shape, arguments: &[ExprId]) -> Option<()> {
        let &[object, getters] = arguments else {
            return None;
        };
        if !self.is_exports_object(object) {
            return None;
        }
        self.add_getters_of_literal(getters)?;
        if shape == Shape::ExportMarksModuleAndDefinesGetters {
            *self.marker = Some(true);
        }
        Some(())
    }

    fn read_export_star(&mut self, arguments: &[ExprId]) -> Option<()> {
        let &[source, object] = arguments else {
            return None;
        };
        if !self.is_exports_object(object) {
            return None;
        }
        self.add_all_of(source)
    }

    fn read_re_export(&mut self, arguments: &[ExprId]) -> Option<()> {
        let (&[target, source] | &[target, source, _]) = arguments else {
            return None;
        };
        let second = arguments.get(2);
        if !self.is_exports_object(target)
            && !second.is_some_and(|&second| self.is_exports_object(second))
        {
            return None;
        }
        self.add_all_of(source)
    }

    fn read_create_binding(&mut self, known: &KnownFunction, arguments: &[ExprId]) -> Option<()> {
        let (&[object, source, key] | &[object, source, key, _]) = arguments else {
            return None;
        };
        let (Shape::CreateBindingDefinesGetter, &[_, getter]) = (known.shape, &known.functions[..])
        else {
            return None;
        };
        let FnOwner::Expr(getter) = self.bound.fns[getter.idx()].owner else {
            return None;
        };
        if !self.is_exports_object(object) || self.is_exports_object(source) {
            return None;
        }
        let renamed = arguments.get(3).copied();
        let renamed = renamed.filter(|&name| self.find_constant(name) != Some(Constant::Undefined));
        let name = self.find_plain_name(renamed.unwrap_or(key))?;
        self.add_getter(name, getter, true)
    }

    fn read_mark_as_module(&mut self, arguments: &[ExprId]) -> Option<()> {
        let &[object] = arguments else {
            return None;
        };
        if !self.is_exports_object(object) {
            return None;
        }
        *self.marker = Some(true);
        Some(())
    }

    fn is_stored_as_exports(&self, call: ExprId) -> bool {
        match self.parent(call) {
            (stored, Parent::Expr(user)) if user.is_some() => matches!(
                self.hir[user].kind,
                ExprKind::Assign { op: None, target, value }
                    if value == stored && self.is_exports_object(target)
            ),
            (_, Parent::Stmt(user)) if user.is_some() => {
                matches!(self.hir[user].kind, StmtKind::ExportAssign(_))
            }
            _ => false,
        }
    }

    fn find_new_empty_object(&self, name: ExprId) -> Option<(SymbolId, u32)> {
        let (hir, bound) = (self.hir, self.bound);
        let name = hir.skip_type_assertions(name);
        let (ExprKind::Ident(_), Binding::Symbol(symbol)) = (hir[name].kind, bound.binding(name))
        else {
            return None;
        };
        let BindingInitializer::Expression(value) = bound.binding_initializer(hir, symbol) else {
            return None;
        };
        let ExprKind::Object(properties) = hir[hir.skip_type_assertions(value)].kind else {
            return None;
        };
        let Parent::VarInit(declaration) = bound.parent_of_expr(value) else {
            return None;
        };
        let is_known = properties.is_empty()
            && bound.is_stable_binding(symbol)
            && !bound.is_visible_to_eval(symbol)
            && bound.parent_of_stmt(bound.var_stmt[declaration.idx()]) == Parent::File;
        is_known.then_some((symbol, hir[value].end))
    }

    fn read_to_common_js(
        &mut self,
        node: ExprId,
        callee: ExprId,
        arguments: &[ExprId],
    ) -> Option<()> {
        let (hir, bound, analysis) = (self.hir, self.bound, self.analysis);
        let &[copied] = arguments else {
            return None;
        };
        if self.inner.is_some() {
            return None;
        }
        let shape = self.find_helper(callee)?.shape;
        if shape != Shape::ToCommonJsCopiesOntoNewMarkedObject || !self.is_stored_as_exports(node) {
            return None;
        }
        let (copied, created_at) = self.find_new_empty_object(copied)?;
        let copied = Binding::Symbol(copied);
        let mut implicit_reads = analysis.bindings_read_without_expression(hir, bound);
        if hir[node].pos < created_at || implicit_reads.any(|binding| binding == copied) {
            return None;
        }
        let copy = hir[self.statement];
        let mut literals: SmallVec<[(u32, ExprId); 2]> = SmallVec::new();
        for mention in (0..hir.exprs.len() as u32).map(ExprId) {
            if !bound.is_evaluated_ident(mention)
                || bound.binding(mention) != copied
                || analysis.decisions.is_dead_expr(mention)
            {
                continue;
            }
            let (argument, Parent::Expr(user)) = self.parent(mention) else {
                return None;
            };
            if user == node {
                continue;
            }
            let (callee, arguments) = self.find_plain_call(user)?;
            if arguments.first() != Some(&argument)
                || hir[user].pos < created_at
                || !self.is_top_level_statement(user)
            {
                return None;
            }
            match (self.find_helper(callee)?.shape.helper(), &arguments[..]) {
                (Helper::Export, &[_, literal]) if hir[user].end <= copy.start => {
                    literals.push((hir[user].pos, literal));
                }
                (Helper::ReExport, _) if hir[user].pos >= copy.loc.end => {}
                _ => return None,
            }
        }
        literals.shared_sort_unstable_by_key(|entry| entry.0);
        let first = self.names.len();
        for &(_, literal) in &literals {
            self.add_getters_of_literal(literal)?;
        }
        let mut copies = self.names[first..].iter();
        if copies.any(|stored| stored.name() == Some(known::__esModule)) {
            return None;
        }
        *self.marker = Some(true);
        Some(())
    }
}
