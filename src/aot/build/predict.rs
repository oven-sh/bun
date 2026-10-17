use super::types::MAX_DESCRIPTION_DEPTH;
use super::{FileBuild, Fx, ImportSource, Source};
use crate::builder::Var;
use crate::declared::{Declared, Part, prim};
use crate::id::{TyId, V};
use crate::ir::{Args, CoerceReason, LayoutKind, Op, Operation, Prediction};
use bun_sema::atom::Atom;
use bun_sema::bind::{Decl, PatParent, required_specifier};
use bun_sema::check::{Checker, ImportedCode};
use bun_sema::hir::{ExprId, FileKind, Flags, FnId, MemberKind, ParamId, PatId, PatKind, PropKey};
use bun_sema::program::{FileId, Sym};
use bun_sema::types::{TypeData, TypeId};
use smallvec::SmallVec;

impl<'c, 'p, 's> FileBuild<'c, 'p, 's> {
    pub(crate) fn imported_code(&mut self, imports: &[Sym]) -> Vec<(Sym, ImportedCode)> {
        let mut code = Vec::new();
        for &import in imports {
            let found = match self
                .is_declared_by_import(import)
                .then(|| self.import_source(import))
            {
                Some(ImportSource::Declaration(exported)) => {
                    Some(ImportedCode::Binding(self.export_value_symbol(exported)))
                }
                Some(ImportSource::Namespace(file)) => Some(ImportedCode::Export(file, None)),
                Some(ImportSource::ExportedObject { file, name, .. }) => {
                    Some(ImportedCode::Export(file, name))
                }
                Some(_) => None,
                None => self.required_code(import),
            };
            code.extend(found.map(|found| (import, found)));
        }
        code
    }

    fn required_code(&self, import: Sym) -> Option<ImportedCode> {
        let (file, pat) =
            self.files
                .decls(import)
                .into_iter()
                .find_map(|(file, decl)| match decl {
                    Decl::Require(pat) => Some((file, pat)),
                    _ => None,
                })?;
        let (hir, bound) = (self.hir(file), self.c.bound(file));
        let (declaration, name) = match bound.pat_parent[pat.idx()] {
            PatParent::Var(declaration) => (declaration, None),
            PatParent::Prop(outer, prop) => {
                let PatParent::Var(declaration) = bound.pat_parent[outer.idx()] else {
                    return None;
                };
                match (hir[prop].key, hir[pat].kind) {
                    (PropKey::Name(name), _) | (PropKey::None, PatKind::Ident(name)) => {
                        (declaration, Some(name))
                    }
                    _ => return None,
                }
            }
            _ => return None,
        };
        let specifier = required_specifier(hir, hir[declaration].init)?;
        Some(ImportedCode::Export(
            self.required_file(file, specifier)?,
            name,
        ))
    }

    pub(crate) fn allocated_as(&mut self, op: &Op, ty: TyId) -> Option<Prediction> {
        if !self.may_be_object_type(ty)
            || matches!(op, Op::New(_) | Op::NewWith { .. } | Op::Coerce { .. })
        {
            return None;
        }
        let (Op::FuncRef(func) | Op::Closure { func, .. } | Op::ClosureOnce { func, .. }) = *op
        else {
            return Some(self.description_prediction(ty));
        };
        Some(match self.sources[func.idx()] {
            Source::Function { .. } => Prediction::Closure(func),
            _ => Prediction::None,
        })
    }

    fn may_be_object_type(&self, ty: TyId) -> bool {
        let described = self.out.tys.get(ty);
        let is_environment = described
            .single_layout()
            .is_some_and(|layout| self.out.layouts[layout.idx()].kind == LayoutKind::Environment);
        ty != self.out.tys.anything && described.has_objects() && !is_environment
    }

    fn wants_prediction(&self, fx: &Fx, value: V) -> bool {
        if fx.is_typed {
            let ty = self.ty(fx, value);
            let described = self.out.tys.get(ty);
            return ty == self.out.tys.anything
                || (described.any_function && !described.any_object);
        }
        !matches!(
            fx.b.func.op(value),
            Some(
                Op::Undefined
                    | Op::Null
                    | Op::Bool(_)
                    | Op::Int(_)
                    | Op::Double(_)
                    | Op::Str(_)
                    | Op::BigInt(_)
                    | Op::Symbol(_)
                    | Op::FuncRef(_)
                    | Op::Closure { .. }
                    | Op::ClosureOnce { .. }
                    | Op::New(_)
                    | Op::NewWith { .. }
                    | Op::NewObject
                    | Op::FreeGet { .. }
            )
        )
    }

    pub(crate) fn predict_expression(&mut self, fx: &mut Fx, value: V, e: ExprId) -> V {
        if !fx.is_typed && self.may_be_object_type(self.ty(fx, value)) {
            let prediction = self.description_prediction(self.ty(fx, value));
            return self.retype_with_prediction(fx, value, self.out.tys.anything, prediction);
        }
        if !self.wants_prediction(fx, value) {
            return value;
        }
        let file = fx.file;
        let prediction = match self.c.predicted_expr_function(file, e) {
            Some((file, func)) => Prediction::Closure(self.forward_declare_function(file, func)),
            None => {
                let Some(expected) = self.c.predicted_expr_type(file, e) else {
                    return value;
                };
                self.prediction_for_type(expected, |c| c.expr_integer_range(file, e))
            }
        };
        self.expect(fx, value, prediction)
    }

    pub(crate) fn convert_builtin_args(
        &mut self,
        fx: &mut Fx,
        file: FileId,
        path: ExprId,
        mut args: Args,
    ) -> Args {
        for (arg, is_number) in args
            .iter_mut()
            .zip(self.c.builtin_number_parameters(file, path))
        {
            let Some(is_number) = is_number else { continue };
            if fx.b.func.prediction(*arg) == Prediction::None && self.wants_prediction(fx, *arg) {
                let expected = if is_number {
                    self.known.number
                } else {
                    self.known.string
                };
                *arg = self.expect(fx, *arg, Prediction::Ty(expected));
            }
        }
        args
    }

    pub(crate) fn predict_callee(&mut self, fx: &mut Fx, callee: V, e: ExprId) -> V {
        if !fx.is_typed
            || fx.b.func.op(callee).is_some()
            || fx.b.func.prediction(callee) != Prediction::None
            || !self.wants_prediction(fx, callee)
        {
            return callee;
        }
        match self.c.function_for_value_expr(fx.file, e) {
            Some((file, func)) if self.shared.is_compiled(file) => {
                let prediction = Prediction::Closure(self.forward_declare_function(file, func));
                self.expect(fx, callee, prediction)
            }
            _ => callee,
        }
    }

    pub(crate) fn predict_declared_method(
        &mut self,
        fx: &mut Fx,
        value: V,
        receiver: TypeId,
        name: &[u8],
    ) -> V {
        let name = self.c.atoms().intern(name);
        let method = self.c.declared_method(receiver, name);
        self.predict_method(fx, value, method)
    }

    pub(crate) fn predict_method(
        &mut self,
        fx: &mut Fx,
        value: V,
        method: Option<(FileId, FnId)>,
    ) -> V {
        match method {
            Some((file, func)) if self.shared.is_compiled(file) => {
                let prediction = Prediction::Closure(self.forward_declare_function(file, func));
                self.expect(fx, value, prediction)
            }
            _ => value,
        }
    }

    pub(crate) fn predict_private_method(&mut self, fx: &mut Fx, value: V, name: Atom) -> V {
        let Some(class) = self.private_name_class(name) else {
            return value;
        };
        let hir = self.hir(fx.file);
        let method = hir[class].members.iter().find(|&member| {
            let m = &hir[member];
            m.kind == MemberKind::Method
                && m.func.is_some()
                && !m.flags.contains(Flags::STATIC)
                && matches!(m.key, PropKey::Private(declared) if declared == name)
        });
        match method {
            Some(member) => {
                let prediction =
                    Prediction::Closure(self.forward_declare_function(fx.file, hir[member].func));
                self.expect(fx, value, prediction)
            }
            None => value,
        }
    }

    pub(crate) fn predict_by_key(&mut self, fx: &mut Fx, value: V, holder: ExprId) -> V {
        if !matches!(fx.b.func.op(value), Some(Op::ElemGet { .. }))
            || fx.b.func.prediction(value) != Prediction::None
            || !self.wants_prediction(fx, value)
        {
            return value;
        }
        match self.c.holding_property(fx.file, holder, 0) {
            Some(property) => {
                let property = self.str(property);
                self.expect(fx, value, Prediction::ByKey(property))
            }
            None => value,
        }
    }

    pub(crate) fn predict_parameter(&mut self, fx: &mut Fx, value: V, p: ParamId) {
        if !self.wants_prediction(fx, value) {
            return;
        }
        let Some(expected) = self.c.predicted_param_type(fx.file, p) else {
            return;
        };
        let prediction = self.prediction_for_type(expected, |_| None);
        self.expect(fx, value, prediction);
    }

    pub(crate) fn predict_binding(&mut self, fx: &mut Fx, value: V, pat: PatId) -> V {
        if !self.wants_prediction(fx, value) || fx.b.func.prediction(value) != Prediction::None {
            return value;
        }
        let Some(expected) = self.c.predicted_pat_type(fx.file, pat) else {
            return value;
        };
        let prediction = self.prediction_for_type(expected, |_| None);
        self.expect(fx, value, prediction)
    }

    pub(crate) fn predict_iteration_value(
        &mut self,
        fx: &mut Fx,
        value: V,
        iterable: ExprId,
        is_await: bool,
    ) -> V {
        let Some(expected) = self.c.predicted_expr_type(fx.file, iterable) else {
            return value;
        };
        let element = self.c.iterated_type(expected, is_await);
        let prediction = self.prediction_for_type(element, |_| None);
        self.expect(fx, value, prediction)
    }

    pub(crate) fn predict_variable(&mut self, fx: &mut Fx, var: Var, sym: Sym) {
        if fx.b.var_type(var) != self.out.tys.anything {
            return;
        }
        let Some(expected) = self.c.predicted_symbol_type(sym) else {
            return;
        };
        let prediction = self.prediction_for_type(expected, |c| c.symbol_integer_range(sym));
        fx.b.set_var_prediction(var, prediction);
    }

    pub(crate) fn expects_closure(&mut self, fx: &Fx, obj: V, callee: ExprId) -> bool {
        if self
            .out
            .tys
            .get(self.ty(fx, obj))
            .parts
            .iter()
            .any(|part| matches!(part, Part::Class(_)))
        {
            let checked = self.c.type_of_expr(fx.file, callee);
            if !self.c.is_uninformative(checked) {
                return false;
            }
        }
        self.c
            .predicted_expr_function(fx.file, callee)
            .is_some_and(|function| self.shared.is_compiled(function.0))
    }

    fn expect(&mut self, fx: &mut Fx, value: V, prediction: Prediction) -> V {
        let ty = self.ty(fx, value);
        let so_far = fx.b.func.prediction(value);
        let tys = &self.out.tys;
        let is_type_neutral = match prediction {
            Prediction::None => true,
            Prediction::Ty(expected) | Prediction::Field(expected) => {
                tys.get(ty).is_subset_of(tys.get(expected))
            }
            Prediction::Closure(_) | Prediction::ByKey(_) => false,
        };
        if is_type_neutral || prediction == so_far {
            return value;
        }
        let is_just_created = value.idx() + 1 == fx.b.func.values.len();
        let is_allocated_for_it = !matches!(fx.b.func.op(value), None | Some(Op::Coerce { .. }));
        if is_just_created && (so_far == Prediction::None || is_allocated_for_it) {
            fx.b.func.values[value.idx()].set_prediction(prediction);
            return value;
        }
        if let (Prediction::Ty(expected), Prediction::Ty(so_far)) = (prediction, so_far)
            && tys.get(so_far).is_subset_of(tys.get(expected))
        {
            return value;
        }
        self.retype_with_prediction(fx, value, ty, prediction)
    }

    pub(crate) fn with_predicted_collection(&mut self, fx: &mut Fx, mut op: Op) -> Op {
        let (Op::CallMethod { obj, .. } | Op::PropGet { obj, .. } | Op::IterOpen(obj)) = &mut op
        else {
            return op;
        };
        if !fx.is_typed || fx.b.func.prediction(*obj) != Prediction::None {
            return op;
        }
        *obj = self.as_predicted_collection(fx, *obj);
        if let Op::CallMethod { obj, name, .. } | Op::PropGet { obj, name } = &mut op
            && matches!(self.out.strs.get(*name), b"next" | b"return" | b"throw")
            && self.is_declared_generator(fx, *obj)
        {
            let ty = self.ty(fx, *obj);
            *obj = fx.b.emit(
                Op::Operation {
                    which: Operation::DeclaredGenerator,
                    args: [*obj].into_iter().collect(),
                },
                ty,
            );
        }
        op
    }

    fn is_declared_generator(&self, fx: &Fx, value: V) -> bool {
        let ty = self.ty(fx, value);
        if ty.is_none() {
            return false;
        }
        let described = self.out.tys.get(ty);
        matches!(&described.parts[..], [Part::Global(name, _)] if self.out.strs.get(*name) == b"Generator")
            && described.prims & !prim::NULLISH == 0
            && described.ints.is_none()
            && !described.any_object
            && !described.any_function
    }

    pub(crate) fn as_predicted_collection(&mut self, fx: &mut Fx, value: V) -> V {
        let ty = self.ty(fx, value);
        if ty.is_none() {
            return value;
        }
        let described = self.out.tys.get(ty);
        let [Part::Global(name, arguments)] = &described.parts[..] else {
            return value;
        };
        if described.prims & !prim::NULLISH != 0
            || described.ints.is_some()
            || described.any_object
            || described.any_function
        {
            return value;
        }
        let allocated_as: &[u8] = match self.out.strs.get(*name) {
            b"ReadonlySet" => b"Set",
            b"ReadonlyMap" => b"Map",
            _ => return value,
        };
        let arguments = arguments.clone();
        let allocated_as = self.out.strs.intern(allocated_as);
        let expected = self
            .out
            .tys
            .intern(Declared::part(Part::Global(allocated_as, arguments)));
        self.retype_with_prediction(fx, value, ty, Prediction::Ty(expected))
    }

    fn retype_with_prediction(
        &mut self,
        fx: &mut Fx,
        value: V,
        ty: TyId,
        prediction: Prediction,
    ) -> V {
        if let Some(&seen) = fx.expected.get(&(fx.b.block, value, prediction)) {
            return seen;
        }
        let seen = self.emit(
            fx,
            Op::Coerce {
                value,
                to: ty,
                why: CoerceReason::Upcast,
            },
        );
        fx.b.func.values[seen.idx()].set_prediction(prediction);
        fx.expected.insert((fx.b.block, value, prediction), seen);
        seen
    }

    fn prediction_for_type(
        &mut self,
        expected: TypeId,
        integers: impl FnOnce(&mut Checker<'p, 's>) -> Option<(i64, i64)>,
    ) -> Prediction {
        if let Some((file, func)) = self.c.function_for_type(expected) {
            return Prediction::Closure(self.forward_declare_function(file, func));
        }
        let described = match self.predicted_description_cache.get(&expected) {
            Some(&known) => known,
            None => {
                let described = self.describe_predicted(expected);
                let described = self.out.tys.intern(described);
                self.predicted_description_cache.insert(expected, described);
                described
            }
        };
        match self.description_prediction(described) {
            Prediction::Ty(ty) if self.out.tys.get(ty).prims & prim::NUMBER != 0 => {
                let integers = integers(&mut *self.c);
                Prediction::Ty(self.with_integers(ty, integers))
            }
            prediction => prediction,
        }
    }

    fn description_prediction(&self, ty: TyId) -> Prediction {
        let described = self.out.tys.get(ty);
        let is_telling = described.prims & !prim::NULLISH != 0
            || described.ints.is_some()
            || !described.parts.is_empty();
        if is_telling && ty != self.out.tys.anything {
            Prediction::Ty(ty)
        } else {
            Prediction::None
        }
    }

    fn describe_predicted(&mut self, ty: TypeId) -> Declared {
        self.describe_predicted_at_depth(ty, 0)
    }

    fn describe_predicted_at_depth(&mut self, ty: TypeId, depth: u8) -> Declared {
        if depth > MAX_DESCRIPTION_DEPTH {
            return Declared::anything();
        }
        if let TypeData::Union(parts) = self.c.data(ty) {
            if let Some(known) = self.predicted_composed_cache.get(&(ty, depth)) {
                return known.clone();
            }
            let mut described = Declared::never();
            for &part in parts.iter() {
                described.merge(&self.describe_predicted_at_depth(part, depth));
            }
            self.predicted_composed_cache
                .insert((ty, depth), described.clone());
            return described;
        }
        if self.c.is_array_or_tuple(ty) {
            if let Some(known) = self.predicted_composed_cache.get(&(ty, depth)) {
                return known.clone();
            }
            let mut element = Declared::never();
            for &argument in self.c.type_arguments(ty) {
                element.merge(&self.describe_predicted_at_depth(argument, depth + 1));
            }
            let element = self.out.tys.intern(element);
            let described = Declared::part(Part::Array(element)).nullable();
            self.predicted_composed_cache
                .insert((ty, depth), described.clone());
            return described;
        }
        match self.c.data(ty) {
            TypeData::Synth(_) | TypeData::ReverseMapped { .. } => {
                Declared::any_object().nullable()
            }
            TypeData::Ref { target, .. }
                if self.hir(target.file).kind == FileKind::Declaration
                    && self.c.global_type_symbol(self.files.symbol(*target).name)
                        == Some(*target) =>
            {
                let name = self.str(self.files.symbol(*target).name);
                Declared::part(Part::Global(name, SmallVec::new())).nullable()
            }
            _ if self.c.is_declared_only_record(ty) => Declared::any_object().nullable(),
            _ => {
                let described = self.ty_of(ty);
                self.out.tys.get(described).clone()
            }
        }
    }
}
