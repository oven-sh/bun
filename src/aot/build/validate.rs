use super::coerce::Ty;
use super::{FileBuild, Fx, Problem, Source};
use crate::builder::Var;
use crate::id::{BlockId, FuncId, GlobalId, StrId, TyId, V};
use crate::ir::{self, BinOp, Op, Operation, RelOp, Term, CoerceReason};
use bun_sema::atom::Atom;
use bun_sema::check::{Constant, OtherKeys, Placeholder, Planned, PlannedPrimitive, Rule, ValidationCall, ValidationPlan};
use bun_sema::hir::{CallId, ExprId, ExprKind, PropKey, PropKind};
use bun_sema::types::TypeId;
use rustc_hash::FxHashMap;
use std::borrow::Cow;
use std::rc::Rc;

mod parse;

#[derive(Copy, Clone, PartialEq, Eq, Hash)]
enum GeneratedFunction {
    Validator { plan: u32, node: u32, records_issues: bool, copies_input: bool, is_given_fresh: bool },
    Parser(u32, u32),
    SchemaValidator(u32),
    Plan(u32),
    PendingIssues,
    Failure(u32),
    SchemaFailure(u32),
    Refusal(u32),
    TemplateMatcher(u32),
}

const BIGINT_TEXT_PATTERN: &[u8] = b"^-?(?:0|[1-9][0-9]*|0[xX][0-9a-fA-F]+|0[oO][0-7]+|0[bB][01]+)$";

fn may_hold_objects(plan: &ValidationPlan, node: u32, depth: u32) -> bool {
    match &plan.nodes[node as usize].planned {
        Planned::Array { .. } | Planned::Tuple { .. } | Planned::Dictionary { .. } | Planned::Object { .. } => true,
        Planned::Union { arms, .. } => depth > 8 || arms.iter().any(|&arm| may_hold_objects(plan, arm, depth + 1)),
        _ => false,
    }
}

fn utf16_length(text: &[u8]) -> i64 {
    i64::from(bun_core::strings::wtf8_len_utf16(text))
}

#[derive(Clone)]
enum ParserByDestination {
    Compiled(u32),
    ExpectingShapes(Rc<[u8]>),
}

#[derive(Default)]
pub(crate) struct Validators {
    plans: Vec<Rc<ValidationPlan>>,
    plan_numbers: FxHashMap<TypeId, u32>,
    parsers_by_destination: FxHashMap<TypeId, Option<ParserByDestination>>,
    functions: FxHashMap<GeneratedFunction, FuncId>,
    functions_by_type: FxHashMap<(TypeId, bool, bool, bool, bool, bool, bool), GeneratedFunction>,
    sources: Vec<GeneratedFunction>,
    rejection_marker: Option<GlobalId>,
    is_building_recursive_node: bool,
    is_at_call_site: bool,
    is_speculative: bool,
    copies_input: bool,
    is_root_fresh: bool,
    memory: Option<V>,
    plans_with_inlined_root: Vec<u32>,
    patterns: FxHashMap<Vec<u8>, GlobalId>,
    templates: Vec<(Vec<Vec<u8>>, Vec<Placeholder>)>,
    safe_result_types: FxHashMap<u32, TypeId>,
}

impl<'c, 'p, 's> FileBuild<'c, 'p, 's> {
    pub(crate) fn validation_call(&mut self, fx: &mut Fx, e: ExprId, call: CallId) -> Option<V> {
        if !fx.is_typed {
            return None;
        }
        let (which, ty) = self.c.validation_call(fx.file, e)?;
        let hir = self.hir(fx.file);
        let pos = hir[e].pos;
        let arguments: Vec<ExprId> = hir.ids(hir[call].args).collect();
        let number = match self.validators.plan_numbers.get(&ty) {
            Some(&known) => known,
            None => {
                let number = self.validators.plans.len() as u32;
                let plan = Rc::new(self.c.validation_plan(ty));
                self.validators.plans.push(plan);
                self.validators.plan_numbers.insert(ty, number);
                number
            }
        };
        let plan = Rc::clone(&self.validators.plans[number as usize]);
        if let Some(first) = plan.unsupported.first() {
            self.problems.push(Problem { file: fx.file, pos, what: Cow::Owned(format!("a type that cannot be validated: {first}")) });
            return Some(self.emit(fx, Op::Undefined));
        }
        if self.shared.constants.records_spans {
            let mut recorded = vec![b'0' + which as u8];
            recorded.extend_from_slice(&plan.to_json());
            let value = self.emit_text(fx, &recorded);
            fx.operand_spans.push(ir::Span { value, start: hir[e].pos, end: hir[e].end, step: crate::audit::VALIDATION });
        }
        let created = self.ty_of(ty);
        self.record_validated_conversion(created);
        for node in &plan.nodes {
            if let Planned::Object { ty, .. } = node.planned {
                let described = self.ty_of(ty);
                self.record_validated_conversion(described);
                if self.is_record_type(ty)
                    && let Some(layout) = self.record_layout(ty)
                {
                    self.record_allocation(layout);
                    let fields: Vec<StrId> = self.out.layouts[layout.idx()].fields.iter().map(|field| field.name).filter(|name| name.is_some()).collect();
                    self.implicit_stores.extend(fields);
                }
            }
        }
        if which == ValidationCall::Schema {
            if !arguments.is_empty() {
                return Some(self.unsupported(fx, pos, "a schema call with an argument"));
            }
            let validate = self.helper_function(fx, GeneratedFunction::SchemaValidator(number), 1);
            let validate = self.emit(fx, Op::FuncRef(validate));
            let version = self.emit(fx, Op::Int(1));
            let vendor = self.emit_text(fx, b"bun");
            let standard = self.emit_plain_object(fx, &[(b"version", version), (b"vendor", vendor), (b"validate", validate)]);
            return Some(self.emit_plain_object(fx, &[(b"~standard", standard)]));
        }
        if arguments.iter().any(|&argument| matches!(hir[argument].kind, ExprKind::Spread(_))) {
            return Some(self.unsupported(fx, pos, "a validation call with a spread argument"));
        }
        if let (ValidationCall::JsonParse, [text, reviver]) = (which, &arguments[..]) {
            let (text, reviver) = (self.expr(fx, *text), self.expr(fx, *reviver));
            let revived = self.emit_global_method_call(fx, b"JSON", b"parse", &[text, reviver]);
            return Some(self.emit_root_validation(fx, &plan, number, None, revived, true, Ty { id: created, checked: ty }));
        }
        let [given] = arguments[..] else { return Some(self.unsupported(fx, pos, "a validation call without exactly one argument")) };
        if which == ValidationCall::Validate
            && let Some(validated) = self.validate_written_object(fx, &plan, number, given, Ty { id: created, checked: ty })
        {
            return Some(validated);
        }
        let mut value = self.expr(fx, given);
        let parses = matches!(which, ValidationCall::Parse | ValidationCall::JsonParse);
        if parses && parse::is_parsed_by_type(&plan) {
            return Some(self.emit_parse_by_type(fx, &plan, number, value, which == ValidationCall::Parse, Ty { id: created, checked: ty }));
        }
        if parses {
            value = self.emit_global_method_call(fx, b"JSON", b"parse", &[value]);
        }
        if which == ValidationCall::SafeValidate {
            let declared = self.c.type_of_expr(fx.file, e);
            let result = Ty { id: self.ty_of(declared), checked: declared };
            self.validators.safe_result_types.insert(number, declared);
            return Some(self.emit_root_validation(fx, &plan, number, Some(result), value, true, Ty { id: created, checked: ty }));
        }
        Some(self.emit_root_validation(fx, &plan, number, None, value, !parses, Ty { id: created, checked: ty }))
    }

    fn validate_written_object(&mut self, fx: &mut Fx, plan: &Rc<ValidationPlan>, number: u32, given: ExprId, validated_as: Ty) -> Option<V> {
        let hir = self.hir(fx.file);
        let ExprKind::Object(props) = hir[given].kind else { return None };
        let root = &plan.nodes[plan.root as usize];
        let Planned::Object { ty, members, others } = &root.planned else { return None };
        let is_plain_data = props.iter().all(|p| match (hir[p].kind, hir[p].key) {
            (PropKind::Spread, _) => true,
            (PropKind::Init | PropKind::Shorthand, PropKey::Name(name)) => self.c.atoms().bytes(name) != b"__proto__",
            _ => false,
        });
        if root.is_recursive || root.default.is_some() || !is_plain_data {
            return None;
        }
        let mut written: Vec<(Option<Atom>, V)> = Vec::with_capacity(props.iter().len());
        for p in props.iter() {
            let value = match (hir[p].kind, hir[p].key) {
                (PropKind::Init, PropKey::Name(name)) => (Some(name), self.expr_with_name(fx, hir[p].value, name)),
                (PropKind::Shorthand, PropKey::Name(name)) => (Some(name), self.expr(fx, hir[p].value)),
                _ => (None, self.expr(fx, hir[p].value)),
            };
            written.push(value);
        }
        let member_of = |build: &Self, name: Atom| members.iter().position(|member| member.name[..] == *build.c.atoms().bytes(name));
        let places: Option<Vec<usize>> = written.iter().map(|&(name, _)| member_of(self, name?)).collect();
        let layout = if self.is_record_type(*ty) { self.record_layout(*ty) } else { None };
        let born_typed = places.zip(layout).and_then(|(mut places, layout)| {
            let is_written_once = places.iter().enumerate().all(|(at, place)| !places[..at].contains(place));
            if matches!(others, OtherKeys::Checked(_)) || !is_written_once {
                return None;
            }
            let defaulted: Vec<usize> = (0..members.len()).filter(|place| !places.contains(place) && !members[*place].is_optional && plan.may_have_default(members[*place].node)).collect();
            places.extend(defaulted);
            let names: Vec<StrId> = places.iter().map(|&place| self.out.strs.intern(&members[place].name)).collect();
            self.names_fit_layout(layout, &names).then_some((places, names, layout))
        });
        let Some((places, names, layout)) = born_typed else {
            let plain = self.emit_plain_object_as_written(fx, &written);
            self.validators.is_root_fresh = true;
            return Some(self.emit_root_validation(fx, plan, number, None, plain, true, validated_as));
        };
        let (fails, done) = (fx.b.new_block(), fx.b.new_block());
        let was_speculative = std::mem::replace(&mut self.validators.is_speculative, true);
        let copied_before = std::mem::replace(&mut self.validators.copies_input, true);
        let undefined = self.emit(fx, Op::Undefined);
        let mut values = Vec::with_capacity(places.len());
        for (at, (&place, &name)) in places.iter().zip(&names).enumerate() {
            let value = written.get(at).map_or(undefined, |written| written.1);
            let checked = self.emit_validation(fx, plan, number, members[place].node, value, fails);
            let field = self.out.layouts[layout.idx()].field(name).unwrap_or(0);
            let want = self.field_type(layout, field);
            values.push(self.convert_validated_graph(fx, checked, want));
        }
        self.validators.is_speculative = was_speculative;
        self.validators.copies_input = copied_before;
        let created = self.emit_typed_object(fx, layout, &names, &values, None);
        let created = self.convert_validated(fx, created, validated_as);
        fx.b.jump(done);
        fx.b.seal(fails);
        fx.b.switch_to(fails);
        let plain = self.emit_plain_object_as_written(fx, &written);
        let thrown = self.emit_rejection(fx, GeneratedFunction::Refusal(number), plain);
        let unwind = fx.handlers.last().map(|&handler| ir::Target::new(handler));
        fx.b.terminate(Term::Throw { value: thrown, unwind, pos: 0 });
        fx.b.seal(done);
        fx.b.switch_to(done);
        Some(created)
    }

    fn emit_plain_object_as_written(&mut self, fx: &mut Fx, written: &[(Option<Atom>, V)]) -> V {
        let plain = self.emit(fx, Op::NewObject);
        for &(name, value) in written {
            let Some(name) = name else {
                self.operation(fx, Operation::CopyDataProperties, &[plain, value]);
                continue;
            };
            let name = self.str(name);
            let key = self.emit(fx, Op::Str(name));
            self.operation(fx, Operation::DefineField, &[plain, key, value]);
        }
        plain
    }

    fn parser_by_destination(&mut self, ty: TypeId) -> Option<ParserByDestination> {
        if let Some(known) = self.validators.parsers_by_destination.get(&ty) {
            return known.clone();
        }
        let parser = self.c.exact_parse_plan(ty).and_then(|plan| {
            if parse::is_parsed_by_type(&plan) && parse::is_small_enough_for_compiled_parsers(&plan) && !parse::has_recursive_union_parsed_twice(&plan) {
                self.validators.plans.push(Rc::new(plan));
                return Some(ParserByDestination::Compiled(self.validators.plans.len() as u32 - 1));
            }
            parse::expected_shapes(&plan).map(|shapes| ParserByDestination::ExpectingShapes(shapes.into()))
        });
        self.validators.parsers_by_destination.insert(ty, parser.clone());
        parser
    }

    pub(crate) fn parse_for_destination_type(&mut self, fx: &mut Fx, e: ExprId, call: CallId) -> Option<V> {
        if !fx.is_typed {
            return None;
        }
        let ty = self.c.parsed_text_destination(fx.file, e)?;
        let parser = self.parser_by_destination(ty)?;
        let hir = self.hir(fx.file);
        let text = self.expr(fx, hir.id_at(hir[call].args, 0));
        Some(match parser {
            ParserByDestination::Compiled(number) => {
                let plan = Rc::clone(&self.validators.plans[number as usize]);
                self.emit_exact_parse(fx, &plan, number, text)
            }
            ParserByDestination::ExpectingShapes(shapes) => self.emit_parse_with_shapes(fx, text, &shapes),
        })
    }

    fn emit_safe_result(&mut self, fx: &mut Fx, declared: Option<TypeId>, is_success: bool, name: &[u8], value: V) -> V {
        let success = self.emit(fx, Op::Bool(is_success));
        let names = [self.out.strs.intern(b"success"), self.out.strs.intern(name)];
        for member in declared.map(|declared| self.c.parts(declared).to_vec()).unwrap_or_default() {
            if self.is_record_type(member)
                && let Some(layout) = self.record_layout(member).filter(|&layout| self.names_fit_layout(layout, &names))
            {
                return self.emit_typed_object(fx, layout, &names, &[success, value], None);
            }
        }
        self.emit_plain_object(fx, &[(b"success", success), (name, value)])
    }

    fn emit_root_validation(&mut self, fx: &mut Fx, plan: &Rc<ValidationPlan>, number: u32, safe_result: Option<Ty>, value: V, is_hot: bool, validated_as: Ty) -> V {
        let (fails, done) = (fx.b.new_block(), fx.b.new_block());
        self.validators.is_at_call_site = self.validators.is_root_fresh || is_hot && !self.validators.plans_with_inlined_root.contains(&number);
        if self.validators.is_at_call_site && !self.validators.is_root_fresh {
            self.validators.plans_with_inlined_root.push(number);
        }
        let copied_before = std::mem::replace(&mut self.validators.copies_input, is_hot);
        let checked = self.emit_validation(fx, plan, number, plan.root, value, fails);
        self.validators.copies_input = copied_before;
        let checked = self.convert_validated_graph(fx, checked, validated_as);
        let Some(safe_result) = safe_result else {
            fx.b.jump(done);
            fx.b.seal(fails);
            fx.b.switch_to(fails);
            let thrown = self.emit_rejection(fx, GeneratedFunction::Refusal(number), value);
            let unwind = fx.handlers.last().map(|&handler| ir::Target::new(handler));
            fx.b.terminate(Term::Throw { value: thrown, unwind, pos: 0 });
            fx.b.seal(done);
            fx.b.switch_to(done);
            return checked;
        };
        let result = fx.b.new_var(self.or_anything(safe_result.id));
        let accepted = self.emit_safe_result(fx, Some(safe_result.checked), true, b"data", checked);
        let accepted = self.coerce_to(fx, accepted, safe_result, CoerceReason::Cast);
        fx.b.write(result, accepted);
        fx.b.jump(done);
        fx.b.seal(fails);
        fx.b.switch_to(fails);
        let failure = self.helper_function(fx, GeneratedFunction::Failure(number), 1);
        self.out.funcs[failure.idx()].result = safe_result.id;
        let refused = self.emit_throwing(fx, Op::CallDirect { func: failure, args: [value].into_iter().collect() });
        fx.b.write(result, refused);
        fx.b.jump(done);
        fx.b.seal(done);
        fx.b.switch_to(done);
        fx.b.read(result)
    }

    fn record_validated_conversion(&mut self, to: TyId) {
        let mut targets = Vec::new();
        self.layout_types_within(to, 4, &mut targets);
        for target in targets {
            self.c.record_cast(&[], target, true, false, true, false);
        }
    }

    fn convert_validated(&mut self, fx: &mut Fx, value: V, validated_as: Ty) -> V {
        fx.checked.insert(value, validated_as.checked);
        let have = Ty { id: self.ty(fx, value), checked: validated_as.checked };
        if validated_as.id.is_none() || !self.out.tys.get(validated_as.id).has_objects() || self.is_within(have, validated_as) {
            let held = self.coerce_to(fx, value, validated_as, CoerceReason::Cast);
            self.mark_fresh_cast(fx, held, value);
            if held != value {
                fx.b.func.values[held.idx()].set_is_validated();
            }
            return held;
        }
        let to = self.cast_target_ty(validated_as.id);
        self.record_validated_conversion(to);
        let held = self.emit_throwing(fx, Op::Coerce { value, to, why: CoerceReason::CastFresh });
        fx.b.func.values[held.idx()].set_is_validated();
        fx.checked.insert(held, validated_as.checked);
        held
    }

    fn convert_validated_graph(&mut self, fx: &mut Fx, value: V, validated_as: Ty) -> V {
        if validated_as.id.is_none() || !self.out.tys.get(validated_as.id).has_objects() {
            return self.convert_validated(fx, value, validated_as);
        }
        let to = self.cast_target_ty(validated_as.id);
        self.record_validated_conversion(to);
        let converted = self.emit_throwing(fx, Op::Coerce { value, to, why: CoerceReason::CoerceFreshGraph });
        fx.b.func.values[converted.idx()].ty = self.out.tys.anything;
        fx.b.func.values[converted.idx()].set_is_validated();
        self.convert_validated(fx, converted, validated_as)
    }

    fn hidden_variable(&mut self, fx: &Fx, name: &[u8]) -> GlobalId {
        let name = self.out.strs.intern(name);
        let key = self.next_hidden_variable_key();
        let variable = self.add_global(name, fx.file, Ty::NONE, key);
        self.out.globals[variable.idx()].initialization = ir::Initialization::Undefined;
        variable
    }

    fn emit_initialized_once(&mut self, fx: &mut Fx, variable: GlobalId, make: impl FnOnce(&mut Self, &mut Fx) -> V) -> V {
        let retained = self.new_temporary(fx);
        let known = self.emit(fx, Op::GlobalGet(variable));
        fx.b.write(retained, known);
        let undefined = self.emit(fx, Op::Undefined);
        let is_first = self.emit(fx, Op::StrictEq { a: known, b: undefined });
        let (makes, next) = (fx.b.new_block(), fx.b.new_block());
        self.branch(fx, is_first, makes, next);
        fx.b.seal(makes);
        fx.b.switch_to(makes);
        let created = make(self, fx);
        self.emit(fx, Op::GlobalSet(variable, created));
        fx.b.write(retained, created);
        fx.b.jump(next);
        fx.b.seal(next);
        fx.b.switch_to(next);
        fx.b.read(retained)
    }

    fn emit_text(&mut self, fx: &mut Fx, text: &[u8]) -> V {
        let text = self.out.strs.intern(text);
        self.emit(fx, Op::Str(text))
    }

    fn emit_planned_constant(&mut self, fx: &mut Fx, constant: &Constant) -> V {
        match constant {
            Constant::Undefined => self.emit(fx, Op::Undefined),
            Constant::Null => self.emit(fx, Op::Null),
            Constant::Boolean(value) => self.emit(fx, Op::Bool(*value)),
            Constant::Number(value) => self.number(fx, *value),
            Constant::Text(text) => self.emit_text(fx, text),
        }
    }

    fn emit_list(&mut self, fx: &mut Fx, items: &[V]) -> V {
        self.emit_throwing(fx, Op::NewArray(items.iter().copied().collect()))
    }

    fn emit_plain_object(&mut self, fx: &mut Fx, members: &[(&[u8], V)]) -> V {
        let created = self.emit(fx, Op::NewObject);
        for &(name, value) in members {
            let key = self.emit_text(fx, name);
            self.operation(fx, Operation::DefineField, &[created, key, value]);
        }
        created
    }

    fn continue_if(&mut self, fx: &mut Fx, holds: V, otherwise: BlockId) {
        let next = fx.b.new_block();
        self.branch(fx, holds, next, otherwise);
        fx.b.seal(next);
        fx.b.switch_to(next);
    }

    fn continue_unless(&mut self, fx: &mut Fx, holds: V, then: BlockId) {
        let next = fx.b.new_block();
        self.branch(fx, holds, then, next);
        fx.b.seal(next);
        fx.b.switch_to(next);
    }

    fn emit_typeof_test(&mut self, fx: &mut Fx, value: V, name: &[u8]) -> V {
        let found = self.emit(fx, Op::TypeOf(value));
        let name = self.emit_text(fx, name);
        self.emit(fx, Op::StrictEq { a: found, b: name })
    }

    fn emit_global_method_call(&mut self, fx: &mut Fx, holder: &[u8], name: &[u8], args: &[V]) -> V {
        let holder = self.out.strs.intern(holder);
        let holder = self.emit_throwing(fx, Op::FreeGet { name: holder, is_typeof: false });
        let name = self.out.strs.intern(name);
        self.emit_throwing(fx, Op::CallMethod { obj: holder, name, args: args.iter().copied().collect() })
    }

    fn emit_member(&mut self, fx: &mut Fx, object: V, name: &[u8]) -> V {
        if !Self::is_field_name(name) {
            let key = self.emit_text(fx, name);
            return self.emit_throwing(fx, Op::ElemGet { obj: object, key });
        }
        let name = self.out.strs.intern(name);
        self.emit_throwing(fx, Op::PropGet { obj: object, name })
    }

    fn emit_own_member(&mut self, fx: &mut Fx, object: V, name: &[u8]) -> V {
        if !bun_sema::check::OBJECT_PROTOTYPE_PROPERTIES.contains(&name) {
            return self.emit_member(fx, object, name);
        }
        let held = self.new_temporary(fx);
        let undefined = self.emit(fx, Op::Undefined);
        fx.b.write(held, undefined);
        let key = self.emit_text(fx, name);
        let is_own = self.emit_global_method_call(fx, b"Object", b"hasOwn", &[object, key]);
        let next = fx.b.new_block();
        self.continue_if(fx, is_own, next);
        let found = self.emit_throwing(fx, Op::ElemGet { obj: object, key });
        fx.b.write(held, found);
        fx.b.jump(next);
        fx.b.seal(next);
        fx.b.switch_to(next);
        fx.b.read(held)
    }

    fn emit_rejection_marker(&mut self, fx: &mut Fx) -> V {
        let variable = match self.validators.rejection_marker {
            Some(known) => known,
            None => {
                let variable = self.hidden_variable(fx, b"refused");
                self.validators.rejection_marker = Some(variable);
                variable
            }
        };
        self.emit_initialized_once(fx, variable, |build, fx| build.emit(fx, Op::NewObject))
    }

    fn continue_if_object(&mut self, fx: &mut Fx, value: V, refuses_arrays: bool, fails: BlockId) {
        let accepted = self.validators.copies_input.then(|| fx.b.new_block());
        if let Some(accepted) = accepted {
            let is_function = self.emit_typeof_test(fx, value, b"function");
            self.continue_unless(fx, is_function, accepted);
        }
        let is_object = self.emit_typeof_test(fx, value, b"object");
        self.continue_if(fx, is_object, fails);
        let null = self.emit(fx, Op::Null);
        let is_null = self.emit(fx, Op::StrictEq { a: value, b: null });
        self.continue_unless(fx, is_null, fails);
        if refuses_arrays {
            let is_array = self.emit_global_method_call(fx, b"Array", b"isArray", &[value]);
            self.continue_unless(fx, is_array, fails);
        }
        if let Some(accepted) = accepted {
            fx.b.jump(accepted);
            fx.b.seal(accepted);
            fx.b.switch_to(accepted);
        }
    }

    fn claim_type(&mut self, fx: &mut Fx, value: V, to: TyId) -> V {
        let claimed = self.emit_throwing(fx, Op::Coerce { value, to, why: CoerceReason::Claim });
        fx.b.func.values[claimed.idx()].set_is_validated();
        claimed
    }

    fn emit_loop(&mut self, fx: &mut Fx, list: V, mut body: impl FnMut(&mut Self, &mut Fx, V, V)) {
        let list = self.claim_type(fx, list, self.known.array);
        let length = self.emit_member(fx, list, b"length");
        fx.b.func.values[length.idx()].ty = self.known.uint32;
        let index = self.new_counter(fx, 0);
        let (head, turn, after) = (fx.b.new_block(), fx.b.new_block(), fx.b.new_block());
        fx.b.jump(head);
        fx.b.switch_to(head);
        let at = fx.b.read(index);
        let is_left = self.emit(fx, Op::Relational { op: RelOp::Lt, a: at, b: length });
        self.branch(fx, is_left, turn, after);
        fx.b.seal(turn);
        fx.b.switch_to(turn);
        self.emit(fx, Op::Poll);
        let item = self.emit_throwing(fx, Op::ElemGet { obj: list, key: at });
        body(self, fx, at, item);
        self.count(fx, index, at);
        fx.b.jump(head);
        fx.b.seal(head);
        fx.b.seal(after);
        fx.b.switch_to(after);
    }

    fn emit_pattern_test(&mut self, fx: &mut Fx, pattern: &[u8], text: V) -> V {
        let variable = match self.validators.patterns.get(pattern) {
            Some(&known) => known,
            None => {
                let variable = self.hidden_variable(fx, b"pattern");
                self.validators.patterns.insert(pattern.to_vec(), variable);
                variable
            }
        };
        let expression = self.emit_initialized_once(fx, variable, |build, fx| {
            let source = build.emit_text(fx, pattern);
            let flags = build.emit_text(fx, b"");
            build.operation(fx, Operation::RegExpLiteral, &[source, flags])
        });
        let name = self.out.strs.intern(b"test");
        self.emit_throwing(fx, Op::CallMethod { obj: expression, name, args: [text].into_iter().collect() })
    }

    fn emit_rules(&mut self, fx: &mut Fx, rules: &[Rule], value: V, fails: BlockId) {
        for rule in rules {
            let holds = self.emit_rule(fx, rule, value);
            self.continue_if(fx, holds, fails);
        }
    }

    fn emit_rule(&mut self, fx: &mut Fx, rule: &Rule, value: V) -> V {
        let compared = |build: &mut Self, fx: &mut Fx, op: RelOp, a: V, n: f64| {
            let b = build.number(fx, n);
            build.emit_throwing(fx, Op::Relational { op, a, b })
        };
        match rule {
            Rule::Integer => self.emit_global_method_call(fx, b"Number", b"isInteger", &[value]),
            Rule::AtLeast(n) => compared(self, fx, RelOp::Ge, value, *n),
            Rule::AtMost(n) => compared(self, fx, RelOp::Le, value, *n),
            Rule::Above(n) => compared(self, fx, RelOp::Gt, value, *n),
            Rule::Below(n) => compared(self, fx, RelOp::Lt, value, *n),
            Rule::MultipleOf(n) => {
                let by = self.number(fx, *n);
                let left = self.emit_throwing(fx, Op::Binary { op: BinOp::Mod, a: value, b: by });
                let zero = self.emit(fx, Op::Int(0));
                self.emit(fx, Op::StrictEq { a: left, b: zero })
            }
            Rule::LengthAtLeast(n) => {
                let length = self.emit_member(fx, value, b"length");
                compared(self, fx, RelOp::Ge, length, *n)
            }
            Rule::LengthAtMost(n) => {
                let length = self.emit_member(fx, value, b"length");
                compared(self, fx, RelOp::Le, length, *n)
            }
            Rule::Pattern(pattern) => self.emit_pattern_test(fx, pattern, value),
            Rule::Format { pattern, .. } if !pattern.is_empty() => self.emit_pattern_test(fx, pattern, value),
            Rule::Format { .. } => self.emit_global_method_call(fx, b"URL", b"canParse", &[value]),
            Rule::Template { texts, placeholders, .. } => {
                let matcher = self.template_matcher(fx, texts, placeholders);
                let text = self.claim_type(fx, value, self.known.string);
                self.emit_throwing(fx, Op::CallDirect { func: matcher, args: [text].into_iter().collect() })
            }
        }
    }

    fn template_matcher(&mut self, fx: &Fx, texts: &[Vec<u8>], placeholders: &[Placeholder]) -> FuncId {
        let index = match self.validators.templates.iter().position(|known| known.0 == texts && known.1 == placeholders) {
            Some(index) => index,
            None => {
                self.validators.templates.push((texts.to_vec(), placeholders.to_vec()));
                self.validators.templates.len() - 1
            }
        };
        let function = self.helper_function(fx, GeneratedFunction::TemplateMatcher(index as u32), 1);
        self.out.funcs[function.idx()].params = vec![self.known.string];
        self.out.funcs[function.idx()].result = self.known.boolean;
        function
    }

    fn emit_string_method_call(&mut self, fx: &mut Fx, text: V, name: &[u8], args: &[V], result: TyId) -> V {
        let name = self.out.strs.intern(name);
        let value = self.emit_throwing(fx, Op::CallMethod { obj: text, name, args: args.iter().copied().collect() });
        fx.b.func.values[value.idx()].ty = result;
        value
    }

    fn emit_index_sum(&mut self, fx: &mut Fx, op: BinOp, index: V, by: i64) -> V {
        if by == 0 {
            return index;
        }
        let by = self.emit(fx, Op::Int(by));
        let moved = self.emit(fx, Op::Binary { op, a: index, b: by });
        fx.b.func.values[moved.idx()].ty = self.known.int32;
        moved
    }

    fn continue_if_compares(&mut self, fx: &mut Fx, op: RelOp, a: V, b: V, otherwise: BlockId) {
        let holds = self.emit(fx, Op::Relational { op, a, b });
        self.continue_if(fx, holds, otherwise);
    }

    fn emit_placeholder_test(&mut self, fx: &mut Fx, placeholder: Placeholder, text: V, start: V, end: V, fails: BlockId) {
        if placeholder == Placeholder::Text {
            return;
        }
        self.continue_if_compares(fx, RelOp::Lt, start, end, fails);
        let part = self.emit_string_method_call(fx, text, b"slice", &[start, end], self.known.string);
        let holds = match placeholder {
            Placeholder::BigInt => self.emit_pattern_test(fx, BIGINT_TEXT_PATTERN, part),
            _ => {
                let number = self.emit_throwing(fx, Op::Unary { op: ir::UnOp::ToNumber, a: part });
                self.emit_global_method_call(fx, b"Number", b"isFinite", &[number])
            }
        };
        self.continue_if(fx, holds, fails);
    }

    fn emit_template_matcher(&mut self, fx: &mut Fx, index: u32) {
        let (texts, placeholders) = self.validators.templates[index as usize].clone();
        let text = self.add_entry_param(fx, Ty::from_id(self.known.string));
        let fails = fx.b.new_block();
        let (prefix, suffix) = (&texts[0], &texts[texts.len() - 1]);
        let length = self.emit_member(fx, text, b"length");
        fx.b.func.values[length.idx()].ty = self.known.int32;
        let shortest = self.emit(fx, Op::Int(utf16_length(prefix) + utf16_length(suffix)));
        self.continue_if_compares(fx, RelOp::Ge, length, shortest, fails);
        for (name, affix) in [(b"startsWith".as_slice(), prefix), (b"endsWith".as_slice(), suffix)] {
            if !affix.is_empty() {
                let affix = self.emit_text(fx, affix);
                let holds = self.emit_string_method_call(fx, text, name, &[affix], self.known.boolean);
                self.continue_if(fx, holds, fails);
            }
        }
        let end = self.emit_index_sum(fx, BinOp::Sub, length, utf16_length(suffix));
        let mut position = self.emit(fx, Op::Int(utf16_length(prefix)));
        for (delimiter, &placeholder) in texts[1..texts.len() - 1].iter().zip(&placeholders) {
            let part_end = if delimiter.is_empty() {
                self.continue_if_compares(fx, RelOp::Lt, position, end, fails);
                self.emit_index_sum(fx, BinOp::Add, position, 1)
            } else {
                let wanted = self.emit_text(fx, delimiter);
                let found = self.emit_string_method_call(fx, text, b"indexOf", &[wanted, position], self.known.int32);
                let zero = self.emit(fx, Op::Int(0));
                self.continue_if_compares(fx, RelOp::Ge, found, zero, fails);
                found
            };
            let next = self.emit_index_sum(fx, BinOp::Add, part_end, utf16_length(delimiter));
            self.continue_if_compares(fx, RelOp::Le, next, end, fails);
            self.emit_placeholder_test(fx, placeholder, text, position, part_end, fails);
            position = next;
        }
        self.emit_placeholder_test(fx, placeholders[placeholders.len() - 1], text, position, end, fails);
        let yes = self.emit(fx, Op::Bool(true));
        self.terminate_with_return(fx, yes);
        fx.b.seal(fails);
        fx.b.switch_to(fails);
        let no = self.emit(fx, Op::Bool(false));
        fx.b.terminate(Term::Return(no));
    }

    fn emit_with_default(&mut self, fx: &mut Fx, default: &Option<Constant>, input: V) -> V {
        let Some(default) = default else { return input };
        let given = self.new_temporary(fx);
        fx.b.write(given, input);
        let undefined = self.emit(fx, Op::Undefined);
        let is_missing = self.emit(fx, Op::StrictEq { a: input, b: undefined });
        let (fills, next) = (fx.b.new_block(), fx.b.new_block());
        self.branch(fx, is_missing, fills, next);
        fx.b.seal(fills);
        fx.b.switch_to(fills);
        let default = self.emit_planned_constant(fx, default);
        fx.b.write(given, default);
        fx.b.jump(next);
        fx.b.seal(next);
        fx.b.switch_to(next);
        fx.b.read(given)
    }

    fn emit_validation(&mut self, fx: &mut Fx, plan: &Rc<ValidationPlan>, number: u32, node: u32, input: V, fails: BlockId) -> V {
        let described = &plan.nodes[node as usize];
        let is_at_call_site = std::mem::take(&mut self.validators.is_at_call_site);
        let is_large_union = !plan.is_exact && matches!(&described.planned, Planned::Union { arms, .. } if arms.len() >= parse::MIN_ARMS_OF_UNION_WITH_OWN_FUNCTION);
        if (described.is_recursive || is_large_union || described.is_ambiguous) && !std::mem::take(&mut self.validators.is_building_recursive_node) {
            let created = self.emit_validator_call(fx, number, node, false, input);
            let mark = self.emit_rejection_marker(fx);
            let is_refused = self.emit(fx, Op::StrictEq { a: created, b: mark });
            self.continue_unless(fx, is_refused, fails);
            return created;
        }
        let input = self.emit_with_default(fx, &described.default, input);
        let records_issues = self.records_issues(plan, node);
        let was_speculative = std::mem::replace(&mut self.validators.is_speculative, !records_issues);
        let checked = match &described.planned {
            Planned::Anything => input,
            Planned::Nothing => {
                fx.b.jump(fails);
                let unreachable = fx.b.new_block();
                fx.b.seal(unreachable);
                fx.b.switch_to(unreachable);
                input
            }
            Planned::Primitive(primitive) => {
                let (name, held): (&[u8], _) = match primitive {
                    PlannedPrimitive::Text => (b"string", self.known.string),
                    PlannedPrimitive::Number => (b"number", self.known.number),
                    PlannedPrimitive::Boolean => (b"boolean", self.known.boolean),
                    PlannedPrimitive::BigInt => (b"bigint", self.known.bigint),
                };
                let is_one = self.emit_typeof_test(fx, input, name);
                self.continue_if(fx, is_one, fails);
                let held = self.claim_type(fx, input, held);
                if *primitive == PlannedPrimitive::Number {
                    let is_finite = self.emit_global_method_call(fx, b"Number", b"isFinite", &[held]);
                    self.continue_if(fx, is_finite, fails);
                }
                held
            }
            Planned::Value(wanted) => {
                let constant = self.emit_planned_constant(fx, wanted);
                let is_it = self.emit(fx, Op::StrictEq { a: input, b: constant });
                self.continue_if(fx, is_it, fails);
                if *wanted == Constant::Number(0.0) { self.claim_type(fx, input, self.known.number) } else { constant }
            }
            Planned::AnyObject => {
                self.continue_if_object(fx, input, false, fails);
                input
            }
            Planned::Array { element, .. } => {
                let is_array = self.emit_global_method_call(fx, b"Array", b"isArray", &[input]);
                self.continue_if(fx, is_array, fails);
                let input = if self.validators.copies_input { self.emit_global_method_call(fx, b"Array", b"from", &[input]) } else { input };
                self.emit_rules(fx, &described.rules, input, fails);
                let stores_elements = self.validators.copies_input && (may_hold_objects(plan, *element, 0) || plan.may_have_default(*element));
                let (plan, element) = (Rc::clone(plan), *element);
                let wasted = self.new_block_for_wasted_work(fx, &plan, element);
                let element_fails = if records_issues { fx.b.new_block() } else { wasted.unwrap_or(fails) };
                let mut failed_at = V::NONE;
                self.emit_loop(fx, input, |build, fx, at, item| {
                    failed_at = at;
                    let checked = build.emit_validation(fx, &plan, number, element, item, element_fails);
                    if stores_elements {
                        build.emit_throwing(fx, Op::ElemSet { obj: input, key: at, value: checked });
                    }
                });
                self.emit_start_of_remembering(fx, wasted, fails);
                if records_issues {
                    let validator = self.recording_validator_below(fx, &plan, number, node);
                    self.emit_failure_landing(fx, element_fails, |build, fx| {
                        let validator = match validator {
                            Some(validator) => build.emit(fx, Op::FuncRef(validator)),
                            None => build.emit(fx, Op::Undefined),
                        };
                        build.emit_issue_record(fx, number, node, failed_at, input, validator);
                        fx.b.jump(fails);
                    });
                }
                self.validators.is_speculative = was_speculative;
                return input;
            }
            Planned::Tuple { elements, .. } => {
                let is_array = self.emit_global_method_call(fx, b"Array", b"isArray", &[input]);
                self.continue_if(fx, is_array, fails);
                let length = self.emit_member(fx, input, b"length");
                let wanted = self.emit(fx, Op::Int(elements.len() as i64));
                let is_whole = self.emit(fx, Op::StrictEq { a: length, b: wanted });
                self.continue_if(fx, is_whole, fails);
                let mut checked = Vec::with_capacity(elements.len());
                let mut wasted = None;
                for (at, &element) in elements.iter().enumerate() {
                    let key = self.emit(fx, Op::Int(at as i64));
                    let item = self.emit_throwing(fx, Op::ElemGet { obj: input, key });
                    wasted = wasted.or_else(|| self.new_block_for_wasted_work(fx, plan, element));
                    checked.push(self.emit_validation(fx, plan, number, element, item, wasted.unwrap_or(fails)));
                }
                self.emit_start_of_remembering(fx, wasted, fails);
                if self.validators.copies_input { self.emit_list(fx, &checked) } else { input }
            }
            Planned::Dictionary { held, .. } => {
                self.continue_if_object(fx, input, true, fails);
                let copy = self.validators.copies_input.then(|| self.emit(fx, Op::NewObject));
                let keys = self.emit_global_method_call(fx, b"Object", b"keys", &[input]);
                let (plan, held) = (Rc::clone(plan), *held);
                let wasted = self.new_block_for_wasted_work(fx, &plan, held);
                self.emit_loop(fx, keys, |build, fx, _, key| {
                    let key = build.claim_type(fx, key, build.known.string);
                    let item = build.emit_throwing(fx, Op::ElemGet { obj: input, key });
                    let checked = build.emit_validation(fx, &plan, number, held, item, wasted.unwrap_or(fails));
                    if let Some(copy) = copy {
                        build.operation(fx, Operation::PutByValDirect, &[copy, key, checked]);
                    }
                });
                self.emit_start_of_remembering(fx, wasted, fails);
                copy.unwrap_or(input)
            }
            Planned::Object { .. } if is_at_call_site => self.emit_object(fx, plan, number, node, input, fails),
            Planned::Object { .. } => {
                let created = self.emit_validator_call(fx, number, node, records_issues, input);
                let undefined = self.emit(fx, Op::Undefined);
                let is_refused = self.emit(fx, Op::StrictEq { a: created, b: undefined });
                self.continue_unless(fx, is_refused, fails);
                created
            }
            Planned::Union { arms, .. } => {
                let result = self.new_temporary(fx);
                let done = fx.b.new_block();
                let mut arms = arms.clone();
                let by_tag = plan.tagged_arms(&arms);
                let accepting_objects = |arms: &[u32]| -> Vec<u32> { arms.iter().copied().filter(|&arm| plan.may_accept_object(arm, false, 0)).collect() };
                let spreads_once = self.validators.copies_input && accepting_objects(&arms).len() >= 2;
                if by_tag.is_some() || spreads_once {
                    let is_no_object = fx.b.new_block();
                    self.continue_if_object(fx, input, true, is_no_object);
                    let given = if spreads_once { self.emit_spread(fx, input) } else { input };
                    let is_fresh = spreads_once && plan.nodes.iter().all(|node| node.default.is_none());
                    if let Some(by_tag) = &by_tag {
                        arms.clone_from(&by_tag.untagged);
                    }
                    let for_objects = accepting_objects(&arms);
                    let otherwise = match for_objects[..] {
                        [] => fails,
                        _ if spreads_once => fx.b.new_block(),
                        _ => is_no_object,
                    };
                    if let Some(by_tag) = &by_tag {
                        let tag = self.emit_member(fx, given, by_tag.name);
                        for (constant, arm) in &by_tag.tagged {
                            let (matches, differs) = (fx.b.new_block(), fx.b.new_block());
                            let wanted = self.emit_planned_constant(fx, constant);
                            let is_it = self.emit(fx, Op::StrictEq { a: tag, b: wanted });
                            self.branch(fx, is_it, matches, differs);
                            fx.b.seal(matches);
                            fx.b.seal(differs);
                            fx.b.switch_to(matches);
                            self.validators.is_root_fresh = is_fresh;
                            let checked = self.emit_validation(fx, plan, number, *arm, given, otherwise);
                            fx.b.write(result, checked);
                            fx.b.jump(done);
                            fx.b.switch_to(differs);
                        }
                    }
                    fx.b.jump(otherwise);
                    if spreads_once && !for_objects.is_empty() {
                        fx.b.seal(otherwise);
                        fx.b.switch_to(otherwise);
                        self.emit_arms_in_turn(fx, plan, number, &for_objects, given, is_fresh, result, done, fails);
                        arms.retain(|&arm| !matches!(plan.nodes[arm as usize].planned, Planned::Object { .. } | Planned::Dictionary { .. }));
                    }
                    fx.b.seal(is_no_object);
                    fx.b.switch_to(is_no_object);
                    if arms.is_empty() {
                        fx.b.jump(fails);
                    }
                }
                self.emit_arms_in_turn(fx, plan, number, &arms, input, false, result, done, fails);
                fx.b.seal(done);
                fx.b.switch_to(done);
                fx.b.read(result)
            }
        };
        self.validators.is_speculative = was_speculative;
        self.emit_rules(fx, &described.rules, checked, fails);
        checked
    }

    fn emit_arms_in_turn(&mut self, fx: &mut Fx, plan: &Rc<ValidationPlan>, number: u32, arms: &[u32], input: V, is_fresh: bool, result: Var, done: BlockId, fails: BlockId) {
        for (at, &arm) in arms.iter().enumerate() {
            let is_last = at + 1 == arms.len();
            let next = if is_last { fails } else { fx.b.new_block() };
            self.validators.is_root_fresh = is_fresh && matches!(plan.nodes[arm as usize].planned, Planned::Object { .. });
            let checked = self.emit_validation(fx, plan, number, arm, input, next);
            fx.b.write(result, checked);
            fx.b.jump(done);
            if !is_last {
                fx.b.seal(next);
                fx.b.switch_to(next);
            }
        }
    }

    fn emit_spread(&mut self, fx: &mut Fx, value: V) -> V {
        let copy = self.emit(fx, Op::NewObject);
        self.operation(fx, Operation::CopyDataProperties, &[copy, value]);
        copy
    }

    pub(super) fn as_int32_if_rules_say_so(&mut self, fx: &mut Fx, rules: &[Rule], value: V) -> V {
        if rules != [Rule::Integer, Rule::AtLeast(f64::from(i32::MIN)), Rule::AtMost(f64::from(i32::MAX))] {
            return value;
        }
        self.emit_conversion_to_int32(fx, value)
    }

    fn records_issues(&self, plan: &ValidationPlan, node: u32) -> bool {
        let described = &plan.nodes[node as usize];
        !self.validators.is_speculative
            && matches!(described.planned, Planned::Object { .. } | Planned::Array { .. })
            && described.default.is_none()
            && !described.is_recursive
            && (described.rules.is_empty() || matches!(described.planned, Planned::Array { .. }))
    }

    fn emit_failure_landing(&mut self, fx: &mut Fx, landing: BlockId, fill: impl FnOnce(&mut Self, &mut Fx)) {
        let resumed = fx.b.block;
        fx.b.seal(landing);
        fx.b.switch_to(landing);
        fill(self, fx);
        fx.b.switch_to(resumed);
    }

    fn recording_validator_below(&mut self, fx: &Fx, plan: &ValidationPlan, number: u32, node: u32) -> Option<FuncId> {
        if !self.records_issues(plan, node) {
            return None;
        }
        match plan.nodes[node as usize].planned {
            Planned::Object { .. } => Some(self.validator_for(fx, number, node, true)),
            Planned::Array { element, .. } if matches!(plan.nodes[element as usize].planned, Planned::Object { .. }) => self.recording_validator_below(fx, plan, number, element),
            _ => None,
        }
    }

    fn emit_issue_record(&mut self, fx: &mut Fx, number: u32, node: u32, position: V, value: V, compiled: V) {
        let plan = self.emit_call_without_arguments(fx, GeneratedFunction::Plan(number));
        let node = self.emit(fx, Op::Int(i64::from(node)));
        self.call_validation_helper(fx, b"recordFailure", &[plan, node, position, value, compiled]);
    }

    fn takes_memory(&self, number: u32, node: u32, records_issues: bool) -> bool {
        !records_issues && self.validators.plans[number as usize].nodes[node as usize].reaches_ambiguous
    }

    fn validator_for(&mut self, fx: &Fx, number: u32, node: u32, records_issues: bool) -> FuncId {
        let parameters = 1 + u16::from(self.takes_memory(number, node, records_issues));
        let is_given_fresh = std::mem::take(&mut self.validators.is_root_fresh);
        self.helper_function(fx, GeneratedFunction::Validator { plan: number, node, records_issues, copies_input: self.validators.copies_input, is_given_fresh }, parameters)
    }

    fn emit_validator_call(&mut self, fx: &mut Fx, number: u32, node: u32, records_issues: bool, input: V) -> V {
        let function = self.validator_for(fx, number, node, records_issues);
        if !self.takes_memory(number, node, records_issues) {
            return self.emit_throwing(fx, Op::CallDirect { func: function, args: [input].into_iter().collect() });
        }
        let memory = match self.validators.memory {
            Some(memory) => memory,
            None => {
                let undefined = self.emit(fx, Op::Undefined);
                self.emit_list(fx, &[undefined])
            }
        };
        self.emit_throwing(fx, Op::CallDirect { func: function, args: [input, memory].into_iter().collect() })
    }

    fn new_block_for_wasted_work(&mut self, fx: &mut Fx, plan: &ValidationPlan, below: u32) -> Option<BlockId> {
        (self.validators.memory.is_some() && plan.nodes[below as usize].reaches_ambiguous).then(|| fx.b.new_block())
    }

    fn emit_start_of_remembering(&mut self, fx: &mut Fx, wasted: Option<BlockId>, fails: BlockId) {
        let (Some(wasted), Some(memory)) = (wasted, self.validators.memory) else { return };
        self.emit_failure_landing(fx, wasted, |build, fx| {
            build.call_validation_helper(fx, b"startRemembering", &[memory]);
            fx.b.jump(fails);
        });
    }

    fn continue_if_remembering(&mut self, fx: &mut Fx, memory: V, otherwise: BlockId) {
        let first = self.emit(fx, Op::Int(0));
        let table = self.emit_throwing(fx, Op::ElemGet { obj: memory, key: first });
        let undefined = self.emit(fx, Op::Undefined);
        let is_off = self.emit(fx, Op::StrictEq { a: table, b: undefined });
        self.continue_unless(fx, is_off, otherwise);
    }

    fn emit_return_of_remembered(&mut self, fx: &mut Fx, memory: V, key: V, input: V) {
        let unknown = fx.b.new_block();
        self.continue_if_remembering(fx, memory, unknown);
        let known = self.call_validation_helper(fx, b"recall", &[memory, key, input]);
        let undefined = self.emit(fx, Op::Undefined);
        let is_unknown = self.emit(fx, Op::StrictEq { a: known, b: undefined });
        self.continue_unless(fx, is_unknown, unknown);
        self.terminate_with_return(fx, known);
        fx.b.seal(unknown);
        fx.b.switch_to(unknown);
    }

    fn emit_remembering(&mut self, fx: &mut Fx, memory: V, key: V, input: V, verdict: V) {
        let next = fx.b.new_block();
        self.continue_if_remembering(fx, memory, next);
        self.call_validation_helper(fx, b"remember", &[memory, key, input, verdict]);
        fx.b.jump(next);
        fx.b.seal(next);
        fx.b.switch_to(next);
    }

    fn first_emitted_for_same_type(&mut self, created: GeneratedFunction) -> GeneratedFunction {
        let (number, node, is_parser, records_issues, copies_input, is_given_fresh) = match created {
            GeneratedFunction::Validator { plan, node, records_issues, copies_input, is_given_fresh } => (plan, node, false, records_issues, copies_input, is_given_fresh),
            GeneratedFunction::Parser(number, node) => (number, node, true, false, false, false),
            _ => return created,
        };
        let plan = &self.validators.plans[number as usize];
        match plan.node_identity(node) {
            Some((ty, is_strict)) => *self.validators.functions_by_type.entry((ty, is_strict, is_parser, records_issues, copies_input, is_given_fresh, plan.is_exact)).or_insert(created),
            None => created,
        }
    }

    fn helper_function(&mut self, fx: &Fx, created: GeneratedFunction, parameters: u16) -> FuncId {
        let created = self.first_emitted_for_same_type(created);
        if let Some(&known) = self.validators.functions.get(&created) {
            return known;
        }
        let name = self.out.strs.intern(b"validate");
        let module = self.module_of(fx.file);
        let at = self.validators.sources.len() as u32;
        self.validators.sources.push(created);
        let function = self.add_func(name, module, 0, ir::FuncKind::Plain, Source::Validator(fx.file, at));
        self.out.funcs[function.idx()].params = vec![TyId::NONE; usize::from(parameters)];
        self.out.funcs[function.idx()].length = parameters;
        self.out.funcs[function.idx()].flags |= ir::func_flags::IS_HIDDEN_IN_STACK_TRACES;
        self.validators.functions.insert(created, function);
        function
    }

    pub(crate) fn emit_validator(&mut self, fx: &mut Fx, at: u32) {
        let (number, node, records_issues, copies_input, is_given_fresh) = match self.validators.sources[at as usize] {
            GeneratedFunction::Validator { plan, node, records_issues, copies_input, is_given_fresh } => (plan, node, records_issues, copies_input, is_given_fresh),
            GeneratedFunction::Parser(number, node) => return self.emit_parser(fx, number, node),
            GeneratedFunction::SchemaValidator(number) => return self.emit_schema_validator(fx, number),
            GeneratedFunction::Plan(number) => return self.emit_plan(fx, number),
            GeneratedFunction::PendingIssues => return self.emit_pending_issues(fx),
            created @ (GeneratedFunction::Failure(number) | GeneratedFunction::SchemaFailure(number) | GeneratedFunction::Refusal(number)) => return self.emit_type_mismatch_result(fx, created, number),
            GeneratedFunction::TemplateMatcher(index) => return self.emit_template_matcher(fx, index),
        };
        let plan = Rc::clone(&self.validators.plans[number as usize]);
        let value = self.add_entry_param(fx, Ty::NONE);
        let memory = self.takes_memory(number, node, records_issues).then(|| self.add_entry_param(fx, Ty::NONE));
        let memory = memory.map(|memory| self.claim_type(fx, memory, self.known.array));
        let fails = fx.b.new_block();
        let was_speculative = std::mem::replace(&mut self.validators.is_speculative, !records_issues);
        let copied_before = std::mem::replace(&mut self.validators.copies_input, copies_input);
        let memory_before = std::mem::replace(&mut self.validators.memory, memory);
        if !matches!(plan.nodes[node as usize].planned, Planned::Object { .. }) {
            let remembered = memory.filter(|_| plan.nodes[node as usize].is_ambiguous).map(|memory| (memory, self.emit(fx, Op::Int(i64::from(at)))));
            if let Some((memory, key)) = remembered {
                self.emit_return_of_remembered(fx, memory, key, value);
            }
            self.validators.is_building_recursive_node = true;
            let checked = self.emit_validation(fx, &plan, number, node, value, fails);
            self.validators.is_speculative = was_speculative;
            self.validators.copies_input = copied_before;
            self.validators.memory = memory_before;
            if let Some((memory, key)) = remembered {
                self.emit_remembering(fx, memory, key, value, checked);
            }
            self.terminate_with_return(fx, checked);
            fx.b.seal(fails);
            fx.b.switch_to(fails);
            let mark = self.emit_rejection_marker(fx);
            if let Some((memory, key)) = remembered {
                self.emit_remembering(fx, memory, key, value, mark);
            }
            return fx.b.terminate(Term::Return(mark));
        }
        self.validators.is_root_fresh = is_given_fresh;
        let created = self.emit_object(fx, &plan, number, node, value, fails);
        self.validators.is_speculative = was_speculative;
        self.validators.copies_input = copied_before;
        self.validators.memory = memory_before;
        self.terminate_with_return(fx, created);
        fx.b.seal(fails);
        fx.b.switch_to(fails);
        let undefined = self.emit(fx, Op::Undefined);
        fx.b.terminate(Term::Return(undefined));
    }

    fn emit_object(&mut self, fx: &mut Fx, plan: &Rc<ValidationPlan>, number: u32, node: u32, value: V, fails: BlockId) -> V {
        let Planned::Object { members, .. } = &plan.nodes[node as usize].planned else { return value };
        let records_issues = self.records_issues(plan, node);
        let (position, recorded) = (self.new_temporary(fx), if records_issues { fx.b.new_block() } else { fails });
        let land = |build: &mut Self, fx: &mut Fx, landing: BlockId, at: usize| {
            if records_issues {
                build.emit_failure_landing(fx, landing, |build, fx| {
                    let at = build.emit(fx, Op::Int(at as i64));
                    fx.b.write(position, at);
                    fx.b.jump(recorded);
                });
            }
        };
        let landing = if records_issues { fx.b.new_block() } else { fails };
        let reported = self.new_temporary(fx);
        fx.b.write(reported, value);
        self.continue_if_object(fx, value, true, landing);
        land(self, fx, landing, 0);
        let holder = if self.validators.copies_input && !std::mem::take(&mut self.validators.is_root_fresh) {
            let copy = self.emit_spread(fx, value);
            fx.b.write(reported, copy);
            copy
        } else {
            value
        };
        let mut in_turn: Vec<usize> = (0..members.len()).collect();
        if self.validators.memory.is_some() {
            in_turn.sort_by_key(|&at| plan.nodes[members[at].node as usize].reaches_ambiguous);
        }
        let mut wasted = None;
        for at in in_turn {
            let member = &members[at];
            let given = self.emit_own_member(fx, holder, &member.name);
            wasted = wasted.or_else(|| self.new_block_for_wasted_work(fx, plan, member.node));
            let landing = if records_issues { fx.b.new_block() } else { wasted.unwrap_or(fails) };
            let checked = self.emit_validation(fx, plan, number, member.node, given, landing);
            if !member.is_optional && plan.may_accept_undefined(member.node) {
                let undefined = self.emit(fx, Op::Undefined);
                let is_undefined = self.emit(fx, Op::StrictEq { a: checked, b: undefined });
                let is_there = fx.b.new_block();
                self.continue_if(fx, is_undefined, is_there);
                let key = self.emit_text(fx, &member.name);
                let is_own = self.emit_global_method_call(fx, b"Object", b"hasOwn", &[holder, key]);
                self.continue_if(fx, is_own, landing);
                fx.b.jump(is_there);
                fx.b.seal(is_there);
                fx.b.switch_to(is_there);
            }
            land(self, fx, landing, at);
            if self.validators.copies_input && may_hold_objects(plan, member.node, 0) {
                let undefined = self.emit(fx, Op::Undefined);
                let next = fx.b.new_block();
                let is_missing = self.emit(fx, Op::StrictEq { a: given, b: undefined });
                self.continue_unless(fx, is_missing, next);
                let key = self.emit_text(fx, &member.name);
                self.operation(fx, Operation::DefineField, &[holder, key, checked]);
                fx.b.jump(next);
                fx.b.seal(next);
                fx.b.switch_to(next);
            }
            if plan.may_have_default(member.node) {
                let undefined = self.emit(fx, Op::Undefined);
                let next = fx.b.new_block();
                let is_missing = self.emit(fx, Op::StrictEq { a: given, b: undefined });
                self.continue_if(fx, is_missing, next);
                let stays_missing = self.emit(fx, Op::StrictEq { a: checked, b: undefined });
                self.continue_unless(fx, stays_missing, next);
                let key = self.emit_text(fx, &member.name);
                self.operation(fx, Operation::DefineField, &[holder, key, checked]);
                fx.b.jump(next);
                fx.b.seal(next);
                fx.b.switch_to(next);
            }
        }
        if let Planned::Object { others: OtherKeys::Checked(held), .. } = plan.nodes[node as usize].planned {
            wasted = wasted.or_else(|| self.new_block_for_wasted_work(fx, plan, held));
        }
        let landing = if records_issues { fx.b.new_block() } else { wasted.unwrap_or(fails) };
        let was_speculative = std::mem::replace(&mut self.validators.is_speculative, true);
        self.emit_validation_of_other_keys(fx, plan, number, node, holder, landing);
        self.validators.is_speculative = was_speculative;
        land(self, fx, landing, members.len());
        self.emit_start_of_remembering(fx, wasted, fails);
        if records_issues {
            let below: Vec<(usize, FuncId)> = members.iter().enumerate().filter_map(|(at, member)| Some((at, self.recording_validator_below(fx, plan, number, member.node)?))).collect();
            self.emit_failure_landing(fx, recorded, |build, fx| {
                let position = fx.b.read(position);
                let mut listed = Vec::with_capacity(2 * below.len());
                for &(at, validator) in &below {
                    listed.push(build.emit(fx, Op::Int(at as i64)));
                    listed.push(build.emit(fx, Op::FuncRef(validator)));
                }
                let compiled = if listed.is_empty() { build.emit(fx, Op::Undefined) } else { build.emit_list(fx, &listed) };
                let reported = fx.b.read(reported);
                build.emit_issue_record(fx, number, node, position, reported, compiled);
                fx.b.jump(fails);
            });
        }
        holder
    }

    fn emit_object_from_parsed_members(&mut self, fx: &mut Fx, plan: &Rc<ValidationPlan>, node: u32, checked: &[V]) -> V {
        let Planned::Object { ty, members, .. } = &plan.nodes[node as usize].planned else { return self.emit(fx, Op::Undefined) };
        let (mut names, mut values) = (Vec::new(), Vec::new());
        for (member, &checked) in members.iter().zip(checked).filter(|(member, _)| !member.is_optional) {
            names.push(self.out.strs.intern(&member.name));
            values.push(checked);
        }
        let layout = if self.is_record_type(*ty) { self.record_layout(*ty).filter(|&layout| self.names_fit_layout(layout, &names)) } else { None };
        let created = match layout {
            Some(layout) => self.emit_typed_object(fx, layout, &names, &values, None),
            None => {
                let created = self.emit(fx, Op::NewObject);
                for (&name, &value) in names.iter().zip(&values) {
                    let key = self.emit(fx, Op::Str(name));
                    self.operation(fx, Operation::DefineField, &[created, key, value]);
                }
                created
            }
        };
        for (member, &checked) in members.iter().zip(checked).filter(|(member, _)| member.is_optional) {
            let undefined = self.emit(fx, Op::Undefined);
            let is_absent = self.emit(fx, Op::StrictEq { a: checked, b: undefined });
            let (stores, next) = (fx.b.new_block(), fx.b.new_block());
            self.branch(fx, is_absent, next, stores);
            fx.b.seal(stores);
            fx.b.switch_to(stores);
            if !Self::is_field_name(&member.name) {
                let key = self.emit_text(fx, &member.name);
                self.operation(fx, Operation::DefineField, &[created, key, checked]);
                fx.b.jump(next);
                fx.b.seal(next);
                fx.b.switch_to(next);
                continue;
            }
            let name = self.out.strs.intern(&member.name);
            let held = match layout.and_then(|layout| Some((layout, self.out.layouts[layout.idx()].field(name)?))) {
                Some((layout, field)) => {
                    let want = self.field_type(layout, field);
                    self.coerce_to(fx, checked, want, CoerceReason::Cast)
                }
                None => checked,
            };
            self.emit_throwing(fx, Op::PropSet { obj: created, name, value: held });
            fx.b.jump(next);
            fx.b.seal(next);
            fx.b.switch_to(next);
        }
        created
    }

    fn emit_validation_of_other_keys(&mut self, fx: &mut Fx, plan: &Rc<ValidationPlan>, number: u32, node: u32, value: V, fails: BlockId) {
        let Planned::Object { others, .. } = &plan.nodes[node as usize].planned else { return };
        if *others != OtherKeys::Untouched {
            let keys = self.emit_global_method_call(fx, b"Object", b"keys", &[value]);
            let (plan, others) = (Rc::clone(plan), *others);
            self.emit_loop(fx, keys, |build, fx, _, key| {
                let key = build.claim_type(fx, key, build.known.string);
                let (is_declared, is_other) = (fx.b.new_block(), fx.b.new_block());
                let Planned::Object { members, .. } = &plan.nodes[node as usize].planned else { return };
                for member in members {
                    let name = build.emit_text(fx, &member.name);
                    let is_it = build.emit(fx, Op::StrictEq { a: key, b: name });
                    build.continue_unless(fx, is_it, is_declared);
                }
                fx.b.jump(is_other);
                fx.b.seal(is_other);
                fx.b.switch_to(is_other);
                match others {
                    OtherKeys::Checked(held) => {
                        let item = build.emit_throwing(fx, Op::ElemGet { obj: value, key });
                        let checked = build.emit_validation(fx, &plan, number, held, item, fails);
                        if build.validators.copies_input && may_hold_objects(&plan, held, 0) {
                            build.operation(fx, Operation::PutByValDirect, &[value, key, checked]);
                        }
                        fx.b.jump(is_declared);
                    }
                    _ => fx.b.jump(fails),
                }
                fx.b.seal(is_declared);
                fx.b.switch_to(is_declared);
            });
        }
    }

    fn emit_schema_validator(&mut self, fx: &mut Fx, number: u32) {
        let plan = Rc::clone(&self.validators.plans[number as usize]);
        let value = self.add_entry_param(fx, Ty::NONE);
        let fails = fx.b.new_block();
        self.validators.is_at_call_site = true;
        let copied_before = std::mem::replace(&mut self.validators.copies_input, true);
        let checked = self.emit_validation(fx, &plan, number, plan.root, value, fails);
        self.validators.copies_input = copied_before;
        let accepted = self.emit_plain_object(fx, &[(b"value", checked)]);
        self.terminate_with_return(fx, accepted);
        fx.b.seal(fails);
        fx.b.switch_to(fails);
        let refused = self.emit_rejection(fx, GeneratedFunction::SchemaFailure(number), value);
        self.terminate_with_return(fx, refused);
    }

    fn emit_rejection(&mut self, fx: &mut Fx, answer: GeneratedFunction, value: V) -> V {
        let answer = self.helper_function(fx, answer, 1);
        let answer = self.emit(fx, Op::FuncRef(answer));
        let undefined = self.emit(fx, Op::Undefined);
        self.operation(fx, Operation::CallNoInline, &[answer, undefined, value])
    }

    fn call_validation_helper(&mut self, fx: &mut Fx, helper: &[u8], args: &[V]) -> V {
        let helper = self.shared.validation_helpers().zip(self.c.atoms().lookup(helper));
        let Some(helper) = helper.and_then(|(file, name)| self.exported_binding(file, name)) else {
            return self.unsupported(fx, 0, "a validation in a program that was loaded without prelude/validation.ts");
        };
        let callee = self.read_sym(fx, helper, 0);
        let this = self.emit(fx, Op::Undefined);
        let operands: Vec<V> = [callee, this].into_iter().chain(args.iter().copied()).collect();
        self.operation(fx, Operation::CallNoInline, &operands)
    }

    fn emit_call_without_arguments(&mut self, fx: &mut Fx, function: GeneratedFunction) -> V {
        let function = self.helper_function(fx, function, 0);
        let function = self.emit(fx, Op::FuncRef(function));
        let undefined = self.emit(fx, Op::Undefined);
        self.operation(fx, Operation::CallNoInline, &[function, undefined])
    }

    fn emit_plan(&mut self, fx: &mut Fx, number: u32) {
        let variable = self.hidden_variable(fx, b"plan");
        let text = self.validators.plans[number as usize].to_json();
        let plan = self.emit_initialized_once(fx, variable, |build, fx| {
            let text = build.emit_text(fx, &text);
            let pending = build.emit_call_without_arguments(fx, GeneratedFunction::PendingIssues);
            build.call_validation_helper(fx, b"preparePlan", &[text, pending])
        });
        self.terminate_with_return(fx, plan);
    }

    fn emit_pending_issues(&mut self, fx: &mut Fx) {
        let variable = self.hidden_variable(fx, b"pendingIssues");
        let pending = self.emit_initialized_once(fx, variable, |build, fx| {
            let undefined = build.emit(fx, Op::Undefined);
            build.emit_list(fx, &[undefined])
        });
        self.terminate_with_return(fx, pending);
    }

    fn emit_type_mismatch_result(&mut self, fx: &mut Fx, created: GeneratedFunction, number: u32) {
        let value = self.add_entry_param(fx, Ty::NONE);
        let plan = self.emit_call_without_arguments(fx, GeneratedFunction::Plan(number));
        let issues = self.call_validation_helper(fx, b"takeIssues", &[plan, value]);
        let answer = match created {
            GeneratedFunction::Failure(_) => {
                let declared = self.validators.safe_result_types.get(&number).copied();
                self.emit_safe_result(fx, declared, false, b"issues", issues)
            }
            GeneratedFunction::SchemaFailure(_) => self.emit_plain_object(fx, &[(b"issues", issues)]),
            _ => self.call_validation_helper(fx, b"throwIssues", &[issues]),
        };
        self.terminate_with_return(fx, answer);
    }
}
