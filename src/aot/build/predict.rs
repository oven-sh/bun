//! Predictions: what a value probably is, where nothing holds it to a type. In a JavaScript function that goes for every value, in
//! TypeScript for one of type `any`. What is expected is for the checker to say: see `sema/check/aot/javascript.rs`. Here it is described
//! and put on the value. The type of the value stays what it is, and no value is tested or changed for the sake of a prediction.

use super::types::MOST_HELD_WITHIN_EACH_OTHER;
use super::{FileBuild, Fx, ImportSource, Source};
use crate::builder::Var;
use crate::declared::{Declared, Part, prim};
use crate::id::{TyId, V};
use crate::ir::{Args, LayoutKind, Op, Prediction, Why};
use bun_sema::bind::{Decl, PatParent, required_specifier};
use bun_sema::check::{Checker, CodeOfImport};
use bun_sema::atom::Atom;
use bun_sema::hir::{ExprId, FileKind, Flags, MemberKind, ParamId, PatId, PatKind, PropKey};
use bun_sema::program::{FileId, Sym};
use bun_sema::types::{TypeData, TypeId};
use smallvec::SmallVec;

impl<'c, 'p, 's> FileBuild<'c, 'p, 's> {
    /// Once for the program, before anything is translated. A parameter is expected to be what the calls of its function pass. Behind an import the checker
    /// sees the declaration of a function, often in a declaration file: it is told which code runs.
    pub(crate) fn code_of_imports(&mut self, imports: &[Sym]) -> Vec<(Sym, CodeOfImport)> {
        let mut code = Vec::new();
        for &import in imports {
            let found = match self.is_declared_by_import(import).then(|| self.import_source(import)) {
                Some(ImportSource::Declaration(exported)) => Some(CodeOfImport::Binding(self.value_symbol_of_export(exported))),
                Some(ImportSource::Namespace(file)) => Some(CodeOfImport::Export(file, None)),
                Some(ImportSource::ExportedObject { file, name, .. }) => Some(CodeOfImport::Export(file, name)),
                Some(_) => None,
                None => self.code_required_by(import),
            };
            code.extend(found.map(|found| (import, found)));
        }
        code
    }

    /// `const a = require("m")` and `const { a } = require("m")` in JavaScript, which the checker takes for imports.
    fn code_required_by(&self, import: Sym) -> Option<CodeOfImport> {
        let (file, pat) = self.files.decls(import).into_iter().find_map(|(file, decl)| match decl {
            Decl::Require(pat) => Some((file, pat)),
            _ => None,
        })?;
        let (hir, bound) = (self.hir(file), self.c.bound(file));
        let (declaration, name) = match bound.pat_parent[pat.idx()] {
            PatParent::Var(declaration) => (declaration, None),
            PatParent::Prop(outer, prop) => {
                let PatParent::Var(declaration) = bound.pat_parent[outer.idx()] else { return None };
                match (hir[prop].key, hir[pat].kind) {
                    (PropKey::Name(name), _) | (PropKey::None, PatKind::Ident(name)) => (declaration, Some(name)),
                    _ => return None,
                }
            }
            _ => return None,
        };
        let specifier = required_specifier(hir, hir[declaration].init)?;
        Some(CodeOfImport::Export(self.required_file(file, specifier)?, name))
    }

    /// In a JavaScript function no value is known for an object, an array or a function, not even one that has just been made. By such a
    /// type the engine takes liberties that only TypeScript grants: an own `push` of an array does not shadow the built-in one. So the
    /// type of what the operation yields is `anything`, and what it would have been is expected of it. `None`: the type stays. It is of
    /// primitives, which have nothing of their own. Or it is one that the operations that follow go by: of an object that is being
    /// made, of a value that has been held to the type of the place it is about to enter.
    pub(crate) fn made_as(&mut self, op: &Op, ty: TyId) -> Option<Prediction> {
        if !self.is_known_for_an_object(ty) || matches!(op, Op::New(_) | Op::NewWith { .. } | Op::Coerce { .. }) {
            return None;
        }
        let (Op::FuncRef(func) | Op::Closure { func, .. } | Op::ClosureOnce { func, .. }) = *op else {
            return Some(self.prediction_of_description(ty));
        };
        Some(match self.sources[func.idx()] {
            Source::Function { .. } => Prediction::Closure(func),
            _ => Prediction::None,
        })
    }

    /// Whether the type says of a value that it is an object of some kind, or may be. Not an environment, which the language does not
    /// see.
    fn is_known_for_an_object(&self, ty: TyId) -> bool {
        let described = self.out.tys.get(ty);
        let is_environment = described.only_layout().is_some_and(|layout| self.out.layouts[layout.idx()].kind == LayoutKind::Environment);
        ty != self.out.tys.anything && described.has_objects() && !is_environment
    }

    /// Whether the checker is asked what it expects of the value.
    fn takes_prediction(&self, fx: &Fx, value: V) -> bool {
        if fx.is_typed {
            // Which function a function is, its type does not say.
            let ty = self.ty(fx, value);
            let described = self.out.tys.get(ty);
            return ty == self.out.tys.anything || (described.any_function && !described.any_object);
        }
        // What has just been made says itself what it is. What a name that the program does not bind stands for, the engine knows.
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

    /// The value of the expression `e`, with what the checker expects it to be.
    pub(crate) fn predict_expression(&mut self, fx: &mut Fx, value: V, e: ExprId) -> V {
        // `new C()` with a class of TypeScript, once the object is made: see `made_as`.
        if !fx.is_typed && self.is_known_for_an_object(self.ty(fx, value)) {
            let prediction = self.prediction_of_description(self.ty(fx, value));
            return self.look_at(fx, value, self.out.tys.anything, prediction);
        }
        if !self.takes_prediction(fx, value) {
            return value;
        }
        let file = fx.file;
        let prediction = match self.c.predicted_function_of_expr(file, e) {
            Some((file, func)) => Prediction::Closure(self.name_function(file, func)),
            None => {
                let Some(expected) = self.c.predicted_type_of_expr(file, e) else { return value };
                self.prediction_of(expected, |c| c.integers_of_expr(file, e))
            }
        };
        self.expect(fx, value, prediction)
    }

    pub(crate) fn converted_for_builtin(&mut self, fx: &mut Fx, file: FileId, path: ExprId, mut args: Args) -> Args {
        for (arg, is_number) in args.iter_mut().zip(self.c.is_number_parameter_of_builtin_at(file, path)) {
            let Some(is_number) = is_number else { continue };
            if fx.b.func.prediction(*arg) == Prediction::None && self.takes_prediction(fx, *arg) {
                let expected = if is_number { self.known.number } else { self.known.string };
                *arg = self.expect(fx, *arg, Prediction::Ty(expected));
            }
        }
        args
    }

    /// `callee`: the value of the expression `e`, which is called or constructed. `new (C || (C = allocator.getC()))(..)`: where two ways meet, the operand
    /// has no definition for the engine to go by, so what is expected is said of the value.
    pub(crate) fn predict_callee(&mut self, fx: &mut Fx, callee: V, e: ExprId) -> V {
        if !fx.is_typed || fx.b.func.op(callee).is_some() || fx.b.func.prediction(callee) != Prediction::None || !self.takes_prediction(fx, callee) {
            return callee;
        }
        match self.c.function_produced_by(fx.file, e) {
            Some((file, func)) if self.shared.is_compiled(file) => {
                let prediction = Prediction::Closure(self.name_function(file, func));
                self.expect(fx, callee, prediction)
            }
            _ => callee,
        }
    }

    pub(crate) fn predict_private_method(&mut self, fx: &mut Fx, value: V, name: Atom) -> V {
        let Some(class) = self.class_of_private_name(name) else { return value };
        let hir = self.hir(fx.file);
        let method = hir[class].members.iter().find(|&member| {
            let m = &hir[member];
            m.kind == MemberKind::Method && m.func.is_some() && !m.flags.contains(Flags::STATIC) && matches!(m.key, PropKey::Private(declared) if declared == name)
        });
        match method {
            Some(member) => {
                let prediction = Prediction::Closure(self.name_function(fx.file, hir[member].func));
                self.expect(fx, value, prediction)
            }
            None => value,
        }
    }

    /// `value`: what `holder[key]` yields. Where nothing else is expected of it and `holder` is the dictionary that is held under a property: what the program stores there under the key.
    pub(crate) fn predict_by_key(&mut self, fx: &mut Fx, value: V, holder: ExprId) -> V {
        if !matches!(fx.b.func.op(value), Some(Op::ElemGet { .. })) || fx.b.func.prediction(value) != Prediction::None || !self.takes_prediction(fx, value) {
            return value;
        }
        match self.c.property_holding(fx.file, holder, 0) {
            Some(property) => {
                let property = self.str(property);
                self.expect(fx, value, Prediction::ByKey(property))
            }
            None => value,
        }
    }

    /// What arrives for the parameter `p`.
    pub(crate) fn predict_parameter(&mut self, fx: &mut Fx, value: V, p: ParamId) {
        if !self.takes_prediction(fx, value) {
            return;
        }
        let Some(expected) = self.c.predicted_type_of_param(fx.file, p) else { return };
        let prediction = self.prediction_of(expected, |_| None);
        self.expect(fx, value, prediction);
    }

    /// What the name `pat` of a pattern is bound to, unless something is expected of it already.
    pub(crate) fn predict_binding(&mut self, fx: &mut Fx, value: V, pat: PatId) -> V {
        if !self.takes_prediction(fx, value) || fx.b.func.prediction(value) != Prediction::None {
            return value;
        }
        let Some(expected) = self.c.predicted_type_of_pat(fx.file, pat) else { return value };
        let prediction = self.prediction_of(expected, |_| None);
        self.expect(fx, value, prediction)
    }

    /// What a loop over `iterable` is handed at each turn.
    pub(crate) fn predict_iteration_value(&mut self, fx: &mut Fx, value: V, iterable: ExprId, is_await: bool) -> V {
        let Some(expected) = self.c.predicted_type_of_expr(fx.file, iterable) else { return value };
        let element = self.c.iterated_type(expected, is_await);
        let prediction = self.prediction_of(element, |_| None);
        self.expect(fx, value, prediction)
    }

    /// What the variable `sym` of the source holds, for where the values that are stored to it meet.
    pub(crate) fn predict_variable(&mut self, fx: &mut Fx, var: Var, sym: Sym) {
        if fx.b.ty_of_var(var) != self.out.tys.anything {
            return;
        }
        let Some(expected) = self.c.predicted_type_of_symbol(sym) else { return };
        let prediction = self.prediction_of(expected, |c| c.integers_of_symbol(sym));
        fx.b.predict_var(var, prediction);
    }

    /// Whether `callee`, which is `obj.name`, is expected to be a closure of one function of the program, and `obj` is not looked at as a
    /// type of the program, by which the engine finds the function itself.
    pub(crate) fn expects_closure(&mut self, fx: &Fx, obj: V, callee: ExprId) -> bool {
        // It finds nothing where the type says nothing of the property: what `class G extends (F as any)` inherits.
        if self.out.tys.get(self.ty(fx, obj)).parts.iter().any(|part| matches!(part, Part::Class(_))) {
            let checked = self.c.type_of_expr(fx.file, callee);
            if !self.c.says_nothing(checked) {
                return false;
            }
        }
        self.c.predicted_function_of_expr(fx.file, callee).is_some_and(|function| self.shared.is_compiled(function.0))
    }

    /// The value with the prediction. Where something else is expected of it already, which holds elsewhere (`typeof x === "string" ?
    /// x.length : x + 1`), it is the same value looked at anew: an `Upcast` to its own type, which is no code.
    fn expect(&mut self, fx: &mut Fx, value: V, prediction: Prediction) -> V {
        let ty = self.ty(fx, value);
        let so_far = fx.b.func.prediction(value);
        let tys = &self.out.tys;
        let adds_nothing_to_type = match prediction {
            Prediction::None => true,
            Prediction::Ty(expected) | Prediction::Field(expected) => tys.get(ty).is_described_within(tys.get(expected)),
            Prediction::Closure(_) | Prediction::ByKey(_) => false,
        };
        if adds_nothing_to_type || prediction == so_far {
            return value;
        }
        // It has just been made, for the expression that this is expected of. Where the values of a variable meet, what is expected of the
        // variable stays, and so does what a value is looked at with.
        let is_just_created = value.idx() + 1 == fx.b.func.values.len();
        let is_created_for_it = !matches!(fx.b.func.op(value), None | Some(Op::Coerce { .. }));
        if is_just_created && (so_far == Prediction::None || is_created_for_it) {
            fx.b.func.values[value.idx()].set_prediction(prediction);
            return value;
        }
        if let (Prediction::Ty(expected), Prediction::Ty(so_far)) = (prediction, so_far)
            && tys.get(so_far).is_described_within(tys.get(expected))
        {
            return value;
        }
        self.look_at(fx, value, ty, prediction)
    }

    pub(crate) fn with_collection_expected(&mut self, fx: &mut Fx, mut op: Op) -> Op {
        let (Op::CallMethod { obj, .. } | Op::PropGet { obj, .. } | Op::IterOpen(obj)) = &mut op else { return op };
        if !fx.is_typed || fx.b.func.prediction(*obj) != Prediction::None {
            return op;
        }
        *obj = self.as_collection_expected(fx, *obj);
        op
    }

    pub(crate) fn as_collection_expected(&mut self, fx: &mut Fx, value: V) -> V {
        let ty = self.ty(fx, value);
        if ty.is_none() {
            return value;
        }
        let described = self.out.tys.get(ty);
        let [Part::Global(name, arguments)] = &described.parts[..] else { return value };
        if described.prims & !prim::NULLISH != 0 || described.ints.is_some() || described.any_object || described.any_function {
            return value;
        }
        let made_as: &[u8] = match self.out.strs.get(*name) {
            b"ReadonlySet" => b"Set",
            b"ReadonlyMap" => b"Map",
            _ => return value,
        };
        let arguments = arguments.clone();
        let made_as = self.out.strs.intern(made_as);
        let expected = self.out.tys.intern(Declared::part(Part::Global(made_as, arguments)));
        self.look_at(fx, value, ty, Prediction::Ty(expected))
    }

    /// The same value, looked at as of the type, which it is, and with the prediction.
    fn look_at(&mut self, fx: &mut Fx, value: V, ty: TyId, prediction: Prediction) -> V {
        if let Some(&seen) = fx.expected.get(&(fx.b.block, value, prediction)) {
            return seen;
        }
        let seen = self.emit(fx, Op::Coerce { value, to: ty, why: Why::Upcast });
        fx.b.func.values[seen.idx()].set_prediction(prediction);
        fx.expected.insert((fx.b.block, value, prediction), seen);
        seen
    }

    /// The checker's type as a prediction. `integers`: which integers the numbers among it are, if that is known.
    fn prediction_of(&mut self, expected: TypeId, integers: impl FnOnce(&mut Checker<'p, 's>) -> Option<(i64, i64)>) -> Prediction {
        if let Some((file, func)) = self.c.function_of_type(expected) {
            return Prediction::Closure(self.name_function(file, func));
        }
        let described = match self.expected_as_described.get(&expected) {
            Some(&known) => known,
            None => {
                let described = self.describe_expected(expected);
                let described = self.out.tys.intern(described);
                self.expected_as_described.insert(expected, described);
                described
            }
        };
        match self.prediction_of_description(described) {
            Prediction::Ty(ty) if self.out.tys.get(ty).prims & prim::NUMBER != 0 => {
                let integers = integers(&mut *self.c);
                Prediction::Ty(self.with_integers(ty, integers))
            }
            prediction => prediction,
        }
    }

    /// That a value is anything, nil, some object or some function is nothing to be fast about.
    fn prediction_of_description(&self, ty: TyId) -> Prediction {
        let described = self.out.tys.get(ty);
        let is_telling = described.prims & !prim::NULLISH != 0 || described.ints.is_some() || !described.parts.is_empty();
        if is_telling && ty != self.out.tys.anything { Prediction::Ty(ty) } else { Prediction::None }
    }

    /// As `ty_of` describes a type, except that no layout comes about for a guess: an object type that the checker has computed, as for
    /// `{ ...a, b }`, may well be of objects that JavaScript makes, which have none.
    fn describe_expected(&mut self, ty: TypeId) -> Declared {
        self.describe_expected_within(ty, 0)
    }

    /// `depth`: as for `ty_within`.
    fn describe_expected_within(&mut self, ty: TypeId, depth: u8) -> Declared {
        if depth > MOST_HELD_WITHIN_EACH_OTHER {
            return Declared::anything();
        }
        if let TypeData::Union(parts) = self.c.data(ty) {
            if let Some(known) = self.expected_of_composed.get(&(ty, depth)) {
                return known.clone();
            }
            let mut described = Declared::never();
            for &part in parts.iter() {
                described = described.or(&self.describe_expected_within(part, depth));
            }
            self.expected_of_composed.insert((ty, depth), described.clone());
            return described;
        }
        if self.c.is_array_or_tuple(ty) {
            if let Some(known) = self.expected_of_composed.get(&(ty, depth)) {
                return known.clone();
            }
            let mut element = Declared::never();
            for &argument in self.c.type_arguments(ty) {
                element = element.or(&self.describe_expected_within(argument, depth + 1));
            }
            let element = self.out.tys.intern(element);
            let described = Declared::part(Part::Array(element)).nilable();
            self.expected_of_composed.insert((ty, depth), described.clone());
            return described;
        }
        match self.c.data(ty) {
            TypeData::Synth(_) | TypeData::ReverseMapped { .. } => Declared::any_object().nilable(),
            // What its type arguments are makes no difference to what the engine tests for.
            TypeData::Ref { target, .. } if self.hir(target.file).kind == FileKind::Declaration && self.c.global_type_symbol(self.files.symbol(*target).name) == Some(*target) => {
                let name = self.str(self.files.symbol(*target).name);
                Declared::part(Part::Global(name, SmallVec::new())).nilable()
            }
            // What a declaration file declares is there for host objects, which have no layout.
            _ if self.c.is_declared_only_record(ty) => Declared::any_object().nilable(),
            _ => {
                let described = self.ty_of(ty);
                self.out.tys.get(described).clone()
            }
        }
    }
}
