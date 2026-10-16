use super::fit::Ty;
use super::{FileBuild, Fx, Problem, Source};
use crate::id::{BlockId, FuncId, GlobalId, TyId, V};
use crate::ir::{self, Args, BinOp, Op, Operation, RelOp, Term, Why};
use bun_sema::check::{Constant, OtherKeys, Planned, PlannedPrimitive, Rule, ValidationCall, ValidationPlan};
use bun_sema::hir::{CallId, ExprId, ExprKind};
use bun_sema::types::TypeId;
use rustc_hash::FxHashMap;
use std::borrow::Cow;
use std::rc::Rc;

mod parse;

#[derive(Copy, Clone, PartialEq, Eq, Hash)]
enum Made {
    Validator(u32, u32),
    Parser(u32, u32),
    SchemaValidator(u32),
    Reporter(u32, u32),
    IssueList(u32),
    Failure(u32),
    SchemaFailure(u32),
    Refusal(u32),
    IssueAdder,
    IssueThrower,
}

#[derive(Default)]
pub(crate) struct Validators {
    plans: Vec<Rc<ValidationPlan>>,
    functions: FxHashMap<Made, FuncId>,
    sources: Vec<Made>,
    refusal_marker: Option<GlobalId>,
    is_building_recursive_node: bool,
    is_at_the_call: bool,
    patterns: FxHashMap<Vec<u8>, GlobalId>,
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
        let plan = Rc::new(self.c.validation_plan(ty, which == ValidationCall::Parse));
        if let Some(first) = plan.unsupported.first() {
            self.problems.push(Problem { file: fx.file, pos, what: Cow::Owned(format!("a type that cannot be validated: {first}")) });
            return Some(self.emit(fx, Op::Undefined));
        }
        let number = self.validators.plans.len() as u32;
        self.validators.plans.push(plan.clone());
        if self.shared.constants.notes_spans {
            let mut noted = vec![b'0' + which as u8];
            noted.extend_from_slice(&plan.to_json());
            let value = self.emit_text(fx, &noted);
            fx.operand_spans.push(ir::Span { value, start: hir[e].pos, end: hir[e].end, step: crate::audit::VALIDATION });
        }
        let made = self.ty_of(ty);
        let to = self.ty_of_cast_target(made);
        self.note_cast(Ty { id: self.out.tys.anything, checked: TypeId::UNKNOWN }, to, Why::Coerce);
        if which == ValidationCall::Schema {
            if !arguments.is_empty() {
                return Some(self.unsupported(fx, pos, "a schema of a type that is handed a value"));
            }
            let validate = self.function_made(fx, Made::SchemaValidator(number), 1);
            let validate = self.emit(fx, Op::FuncRef(validate));
            let version = self.emit(fx, Op::Int(1));
            let vendor = self.emit_text(fx, b"bun");
            let standard = self.emit_plain_object(fx, &[(b"version", version), (b"vendor", vendor), (b"validate", validate)]);
            return Some(self.emit_plain_object(fx, &[(b"~standard", standard)]));
        }
        let [given] = arguments[..] else { return Some(self.unsupported(fx, pos, "a validation that is not handed exactly one value")) };
        if matches!(hir[given].kind, ExprKind::Spread(_)) {
            return Some(self.unsupported(fx, pos, "a validation that is handed a spread"));
        }
        let mut value = self.expr(fx, given);
        if which == ValidationCall::Parse && parse::is_parsed_by_type(&plan) {
            return Some(self.emit_parse_by_type(fx, &plan, number, value));
        }
        if which == ValidationCall::Parse {
            value = self.emit_global_method_call(fx, b"JSON", b"parse", &[value]);
        }
        Some(self.emit_root_validation(fx, &plan, number, which == ValidationCall::SafeValidate, value))
    }

    fn emit_root_validation(&mut self, fx: &mut Fx, plan: &Rc<ValidationPlan>, number: u32, is_safe: bool, value: V) -> V {
        let (fails, done) = (fx.b.new_block(), fx.b.new_block());
        let result = self.new_temporary(fx);
        self.validators.is_at_the_call = true;
        let checked = self.emit_validation(fx, plan, number, plan.root, value, fails);
        let accepted = if is_safe {
            let yes = self.emit(fx, Op::Bool(true));
            self.emit_plain_object(fx, &[(b"success", yes), (b"data", checked)])
        } else {
            checked
        };
        fx.b.write(result, accepted);
        fx.b.jump(done);
        fx.b.seal(fails);
        fx.b.switch_to(fails);
        let refused = self.emit_refusal(fx, if is_safe { Made::Failure(number) } else { Made::Refusal(number) }, value);
        fx.b.write(result, refused);
        fx.b.jump(done);
        fx.b.seal(done);
        fx.b.switch_to(done);
        fx.b.read(result)
    }

    fn hidden_variable(&mut self, fx: &Fx, name: &[u8]) -> GlobalId {
        let name = self.out.strs.intern(name);
        let key = self.key_of_next_hidden_variable();
        let variable = self.add_global(name, fx.file, Ty::NONE, key);
        self.out.globals[variable.idx()].initialization = ir::Initialization::Undefined;
        variable
    }

    fn emit_made_once(&mut self, fx: &mut Fx, variable: GlobalId, make: impl FnOnce(&mut Self, &mut Fx) -> V) -> V {
        let kept = self.new_temporary(fx);
        let known = self.emit(fx, Op::GlobalGet(variable));
        fx.b.write(kept, known);
        let undefined = self.emit(fx, Op::Undefined);
        let is_first = self.emit(fx, Op::StrictEq { a: known, b: undefined });
        let (makes, next) = (fx.b.new_block(), fx.b.new_block());
        self.branch(fx, is_first, makes, next);
        fx.b.seal(makes);
        fx.b.switch_to(makes);
        let made = make(self, fx);
        self.emit(fx, Op::GlobalSet(variable, made));
        fx.b.write(kept, made);
        fx.b.jump(next);
        fx.b.seal(next);
        fx.b.switch_to(next);
        fx.b.read(kept)
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
        let made = self.emit(fx, Op::NewObject);
        for &(name, value) in members {
            let key = self.emit_text(fx, name);
            self.operation(fx, Operation::DefineField, &[made, key, value]);
        }
        made
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

    fn emit_refusal_marker(&mut self, fx: &mut Fx) -> V {
        let variable = match self.validators.refusal_marker {
            Some(known) => known,
            None => {
                let variable = self.hidden_variable(fx, b"refused");
                self.validators.refusal_marker = Some(variable);
                variable
            }
        };
        self.emit_made_once(fx, variable, |build, fx| build.emit(fx, Op::NewObject))
    }

    fn continue_if_object(&mut self, fx: &mut Fx, value: V, refuses_arrays: bool, fails: BlockId) {
        let is_object = self.emit_typeof_test(fx, value, b"object");
        self.continue_if(fx, is_object, fails);
        let null = self.emit(fx, Op::Null);
        let is_null = self.emit(fx, Op::StrictEq { a: value, b: null });
        self.continue_unless(fx, is_null, fails);
        if refuses_arrays {
            let is_array = self.emit_global_method_call(fx, b"Array", b"isArray", &[value]);
            self.continue_unless(fx, is_array, fails);
        }
    }

    fn claim_type(&mut self, fx: &mut Fx, value: V, to: TyId) -> V {
        self.emit_throwing(fx, Op::Coerce { value, to, why: Why::Claim })
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
        let expression = self.emit_made_once(fx, variable, |build, fx| {
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
        }
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
        let is_at_the_call = std::mem::take(&mut self.validators.is_at_the_call);
        if described.is_recursive && !std::mem::take(&mut self.validators.is_building_recursive_node) {
            let function = self.validator_for(fx, number, node, TypeId::UNRESOLVED);
            let made = self.emit_throwing(fx, Op::CallDirect { func: function, args: [input].into_iter().collect() });
            let mark = self.emit_refusal_marker(fx);
            let is_refused = self.emit(fx, Op::StrictEq { a: made, b: mark });
            self.continue_unless(fx, is_refused, fails);
            return made;
        }
        let input = self.emit_with_default(fx, &described.default, input);
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
            Planned::Value(constant) => {
                let constant = self.emit_planned_constant(fx, constant);
                let is_it = self.emit(fx, Op::StrictEq { a: input, b: constant });
                self.continue_if(fx, is_it, fails);
                constant
            }
            Planned::AnyObject => {
                self.continue_if_object(fx, input, false, fails);
                input
            }
            Planned::Array { ty, element } => {
                let is_array = self.emit_global_method_call(fx, b"Array", b"isArray", &[input]);
                self.continue_if(fx, is_array, fails);
                self.emit_rules(fx, &described.rules, input, fails);
                let want = Ty { id: self.ty_of(*ty), checked: *ty };
                let list = self.emit_throwing(fx, Op::NewArray(Args::new()));
                let list = self.fit(fx, list, want, Why::Cast);
                let (plan, element) = (plan.clone(), *element);
                self.emit_loop(fx, input, |build, fx, _, item| {
                    let checked = build.emit_validation(fx, &plan, number, element, item, fails);
                    let push = build.out.strs.intern(b"push");
                    build.emit_throwing(fx, Op::CallMethod { obj: list, name: push, args: [checked].into_iter().collect() });
                });
                return list;
            }
            Planned::Tuple { ty, elements } => {
                let is_array = self.emit_global_method_call(fx, b"Array", b"isArray", &[input]);
                self.continue_if(fx, is_array, fails);
                let length = self.emit_member(fx, input, b"length");
                let wanted = self.emit(fx, Op::Int(elements.len() as i64));
                let is_whole = self.emit(fx, Op::StrictEq { a: length, b: wanted });
                self.continue_if(fx, is_whole, fails);
                let mut checked = Vec::with_capacity(elements.len());
                for (at, &element) in elements.iter().enumerate() {
                    let key = self.emit(fx, Op::Int(at as i64));
                    let item = self.emit_throwing(fx, Op::ElemGet { obj: input, key });
                    checked.push(self.emit_validation(fx, plan, number, element, item, fails));
                }
                let made = self.emit_list(fx, &checked);
                let want = Ty { id: self.ty_of(*ty), checked: *ty };
                self.fit(fx, made, want, Why::Cast)
            }
            Planned::Dictionary { held, .. } => {
                self.continue_if_object(fx, input, true, fails);
                let made = self.emit(fx, Op::NewObject);
                let keys = self.emit_global_method_call(fx, b"Object", b"keys", &[input]);
                let (plan, held) = (plan.clone(), *held);
                self.emit_loop(fx, keys, |build, fx, _, key| {
                    let key = build.claim_type(fx, key, build.known.string);
                    let item = build.emit_throwing(fx, Op::ElemGet { obj: input, key });
                    let checked = build.emit_validation(fx, &plan, number, held, item, fails);
                    build.operation(fx, Operation::PutByValDirect, &[made, key, checked]);
                });
                made
            }
            Planned::Object { .. } if is_at_the_call => self.emit_object(fx, plan, number, node, input, fails),
            Planned::Object { ty, .. } => {
                let function = self.validator_for(fx, number, node, *ty);
                let made = self.emit_throwing(fx, Op::CallDirect { func: function, args: [input].into_iter().collect() });
                let undefined = self.emit(fx, Op::Undefined);
                let is_refused = self.emit(fx, Op::StrictEq { a: made, b: undefined });
                self.continue_unless(fx, is_refused, fails);
                made
            }
            Planned::Union { arms, .. } => {
                let result = self.new_temporary(fx);
                let done = fx.b.new_block();
                for (at, &arm) in arms.iter().enumerate() {
                    let is_last = at + 1 == arms.len();
                    let next = if is_last { fails } else { fx.b.new_block() };
                    let checked = self.emit_validation(fx, plan, number, arm, input, next);
                    fx.b.write(result, checked);
                    fx.b.jump(done);
                    if !is_last {
                        fx.b.seal(next);
                        fx.b.switch_to(next);
                    }
                }
                fx.b.seal(done);
                fx.b.switch_to(done);
                fx.b.read(result)
            }
        };
        self.emit_rules(fx, &described.rules, checked, fails);
        checked
    }

    fn validator_for(&mut self, fx: &Fx, number: u32, node: u32, ty: TypeId) -> FuncId {
        let function = self.function_made(fx, Made::Validator(number, node), 1);
        if ty != TypeId::UNRESOLVED {
            let made = self.ty_of(ty);
            self.out.funcs[function.idx()].result = self.or_undefined(made);
        }
        function
    }

    fn function_made(&mut self, fx: &Fx, made: Made, parameters: u16) -> FuncId {
        if let Some(&known) = self.validators.functions.get(&made) {
            return known;
        }
        let name = self.out.strs.intern(b"validate");
        let module = self.module_of(fx.file);
        let at = self.validators.sources.len() as u32;
        self.validators.sources.push(made);
        let function = self.add_func(name, module, 0, ir::FuncKind::Plain, Source::Validator(fx.file, at));
        self.out.funcs[function.idx()].params = vec![TyId::NONE; usize::from(parameters)];
        self.out.funcs[function.idx()].length = parameters;
        self.out.funcs[function.idx()].flags |= ir::func_flags::IS_HIDDEN_IN_STACK_TRACES;
        self.validators.functions.insert(made, function);
        function
    }

    pub(crate) fn emit_validator(&mut self, fx: &mut Fx, at: u32) {
        let (number, node) = match self.validators.sources[at as usize] {
            Made::Validator(number, node) => (number, node),
            Made::Parser(number, node) => return self.emit_parser(fx, number, node),
            Made::SchemaValidator(number) => return self.emit_schema_validator(fx, number),
            Made::Reporter(number, node) => return self.emit_reporter(fx, number, node),
            Made::IssueList(number) => return self.emit_issue_list(fx, number),
            made @ (Made::Failure(number) | Made::SchemaFailure(number) | Made::Refusal(number)) => return self.emit_answer_to_refused_value(fx, made, number),
            Made::IssueAdder => return self.emit_issue_adder(fx),
            Made::IssueThrower => return self.emit_issue_thrower(fx),
        };
        let plan = self.validators.plans[number as usize].clone();
        let value = self.add_entry_param(fx, Ty::NONE);
        let fails = fx.b.new_block();
        if !matches!(plan.nodes[node as usize].planned, Planned::Object { .. }) {
            self.validators.is_building_recursive_node = true;
            let checked = self.emit_validation(fx, &plan, number, node, value, fails);
            self.terminate_with_return(fx, checked);
            fx.b.seal(fails);
            fx.b.switch_to(fails);
            let mark = self.emit_refusal_marker(fx);
            return fx.b.terminate(Term::Return(mark));
        }
        let made = self.emit_object(fx, &plan, number, node, value, fails);
        self.terminate_with_return(fx, made);
        fx.b.seal(fails);
        fx.b.switch_to(fails);
        let undefined = self.emit(fx, Op::Undefined);
        fx.b.terminate(Term::Return(undefined));
    }

    fn emit_object(&mut self, fx: &mut Fx, plan: &Rc<ValidationPlan>, number: u32, node: u32, value: V, fails: BlockId) -> V {
        let Planned::Object { members, .. } = &plan.nodes[node as usize].planned else { return value };
        self.continue_if_object(fx, value, true, fails);
        let mut checked = Vec::with_capacity(members.len());
        for member in members {
            let given = self.emit_member(fx, value, &member.name);
            if !member.is_omitted_when_invalid {
                checked.push(self.emit_validation(fx, plan, number, member.node, given, fails));
                continue;
            }
            let held = self.new_temporary(fx);
            let (invalid, next) = (fx.b.new_block(), fx.b.new_block());
            let conforming = self.emit_validation(fx, plan, number, member.node, given, invalid);
            fx.b.write(held, conforming);
            fx.b.jump(next);
            fx.b.seal(invalid);
            fx.b.switch_to(invalid);
            let undefined = self.emit(fx, Op::Undefined);
            fx.b.write(held, undefined);
            fx.b.jump(next);
            fx.b.seal(next);
            fx.b.switch_to(next);
            checked.push(fx.b.read(held));
        }
        self.emit_object_of_checked_members(fx, plan, number, node, Some(value), &checked, fails)
    }

    fn emit_object_of_checked_members(&mut self, fx: &mut Fx, plan: &Rc<ValidationPlan>, number: u32, node: u32, source: Option<V>, checked: &[V], fails: BlockId) -> V {
        let Planned::Object { ty, members, others } = &plan.nodes[node as usize].planned else { return self.emit(fx, Op::Undefined) };
        let (mut names, mut values) = (Vec::new(), Vec::new());
        for (member, &checked) in members.iter().zip(checked).filter(|(member, _)| !member.is_optional) {
            names.push(self.out.strs.intern(&member.name));
            values.push(checked);
        }
        let layout = if self.is_object_type_of_program(*ty) { self.record_layout(*ty).filter(|&layout| self.fits(layout, &names)) } else { None };
        let made = match layout {
            Some(layout) => self.emit_object_of_layout(fx, layout, &names, &values, None),
            None => {
                let made = self.emit(fx, Op::NewObject);
                for (&name, &value) in names.iter().zip(&values) {
                    let key = self.emit(fx, Op::Str(name));
                    self.operation(fx, Operation::DefineField, &[made, key, value]);
                }
                made
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
                self.operation(fx, Operation::DefineField, &[made, key, checked]);
                fx.b.jump(next);
                fx.b.seal(next);
                fx.b.switch_to(next);
                continue;
            }
            let name = self.out.strs.intern(&member.name);
            let held = match layout.and_then(|layout| Some((layout, self.out.layouts[layout.idx()].field(name)?))) {
                Some((layout, field)) => {
                    let want = self.type_of_field(layout, field);
                    self.fit(fx, checked, want, Why::Cast)
                }
                None => checked,
            };
            self.emit_throwing(fx, Op::PropSet { obj: made, name, value: held });
            fx.b.jump(next);
            fx.b.seal(next);
            fx.b.switch_to(next);
        }
        if let (Some(value), true) = (source, *others != OtherKeys::Omitted) {
            let keys = self.emit_global_method_call(fx, b"Object", b"keys", &[value]);
            let (plan, others) = (plan.clone(), *others);
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
                    OtherKeys::Kept(held) => {
                        let item = build.emit_throwing(fx, Op::ElemGet { obj: value, key });
                        let checked = build.emit_validation(fx, &plan, number, held, item, fails);
                        build.operation(fx, Operation::PutByValDirect, &[made, key, checked]);
                        fx.b.jump(is_declared);
                    }
                    _ => fx.b.jump(fails),
                }
                fx.b.seal(is_declared);
                fx.b.switch_to(is_declared);
            });
        }
        made
    }

    fn emit_schema_validator(&mut self, fx: &mut Fx, number: u32) {
        let plan = self.validators.plans[number as usize].clone();
        let value = self.add_entry_param(fx, Ty::NONE);
        let fails = fx.b.new_block();
        self.validators.is_at_the_call = true;
        let checked = self.emit_validation(fx, &plan, number, plan.root, value, fails);
        let accepted = self.emit_plain_object(fx, &[(b"value", checked)]);
        self.terminate_with_return(fx, accepted);
        fx.b.seal(fails);
        fx.b.switch_to(fails);
        let refused = self.emit_refusal(fx, Made::SchemaFailure(number), value);
        self.terminate_with_return(fx, refused);
    }

    fn emit_refusal(&mut self, fx: &mut Fx, answer: Made, value: V) -> V {
        let answer = self.function_made(fx, answer, 1);
        let answer = self.emit(fx, Op::FuncRef(answer));
        let undefined = self.emit(fx, Op::Undefined);
        self.operation(fx, Operation::CallNoInline, &[answer, undefined, value])
    }

    fn emit_answer_to_refused_value(&mut self, fx: &mut Fx, made: Made, number: u32) {
        let value = self.add_entry_param(fx, Ty::NONE);
        let list = self.function_made(fx, Made::IssueList(number), 1);
        let issues = self.emit_throwing(fx, Op::CallDirect { func: list, args: [value].into_iter().collect() });
        let answer = match made {
            Made::Failure(_) => {
                let no = self.emit(fx, Op::Bool(false));
                self.emit_plain_object(fx, &[(b"success", no), (b"issues", issues)])
            }
            Made::SchemaFailure(_) => self.emit_plain_object(fx, &[(b"issues", issues)]),
            _ => {
                let thrower = self.function_made(fx, Made::IssueThrower, 1);
                self.emit_throwing(fx, Op::CallDirect { func: thrower, args: [issues].into_iter().collect() })
            }
        };
        self.terminate_with_return(fx, answer);
    }

    fn emit_issue_list(&mut self, fx: &mut Fx, number: u32) {
        let plan = self.validators.plans[number as usize].clone();
        let value = self.add_entry_param(fx, Ty::NONE);
        let issues = self.emit_list(fx, &[]);
        let path = self.emit_list(fx, &[]);
        self.emit_report(fx, &plan, number, plan.root, value, path, issues);
        let length = self.emit_member(fx, issues, b"length");
        let zero = self.emit(fx, Op::Int(0));
        let is_empty = self.emit(fx, Op::StrictEq { a: length, b: zero });
        let (none, some) = (fx.b.new_block(), fx.b.new_block());
        self.branch(fx, is_empty, none, some);
        fx.b.seal(none);
        fx.b.seal(some);
        fx.b.switch_to(none);
        self.throw_error(fx, b"Error", b"Internal error: a value was refused by its type and no issue was found. This is a bug in Bun.");
        fx.b.switch_to(some);
        self.terminate_with_return(fx, issues);
    }

    fn emit_issue_thrower(&mut self, fx: &mut Fx) {
        let issues = self.add_entry_param(fx, Ty::NONE);
        let zero = self.emit(fx, Op::Int(0));
        let first = self.emit_throwing(fx, Op::ElemGet { obj: issues, key: zero });
        let path = self.emit_member(fx, first, b"path");
        let length = self.emit_member(fx, path, b"length");
        let place = self.new_temporary(fx);
        let nowhere = self.emit_text(fx, b"");
        fx.b.write(place, nowhere);
        let (within, next) = (fx.b.new_block(), fx.b.new_block());
        self.branch(fx, length, within, next);
        fx.b.seal(within);
        fx.b.switch_to(within);
        let dot = self.emit_text(fx, b".");
        let join = self.out.strs.intern(b"join");
        let joined = self.emit_throwing(fx, Op::CallMethod { obj: path, name: join, args: [dot].into_iter().collect() });
        let colon = self.emit_text(fx, b": ");
        let joined = self.emit_joined(fx, &[joined, colon]);
        fx.b.write(place, joined);
        fx.b.jump(next);
        fx.b.seal(next);
        fx.b.switch_to(next);
        let place = fx.b.read(place);
        let message = self.emit_member(fx, first, b"message");
        let text = self.emit_joined(fx, &[place, message]);
        let class = self.out.strs.intern(b"TypeError");
        let class = self.emit_throwing(fx, Op::FreeGet { name: class, is_typeof: false });
        let error = self.emit_throwing(fx, Op::Construct { callee: class, args: [text].into_iter().collect() });
        let name = self.out.strs.intern(b"issues");
        self.emit_throwing(fx, Op::PropSet { obj: error, name, value: issues });
        fx.b.terminate(Term::Throw { value: error, unwind: None, pos: 0 });
    }

    fn emit_joined(&mut self, fx: &mut Fx, parts: &[V]) -> V {
        let mut joined = parts[0];
        for &part in &parts[1..] {
            joined = self.emit_throwing(fx, Op::Binary { op: BinOp::Add, a: joined, b: part });
        }
        joined
    }

    fn emit_issue_adder(&mut self, fx: &mut Fx) {
        let [issues, path, code, expected, value, message] = std::array::from_fn(|_| self.add_entry_param(fx, Ty::NONE));
        let received = self.new_temporary(fx);
        let described = fx.b.new_block();
        let says = |build: &mut Self, fx: &mut Fx, holds: V, text: &[u8]| {
            let (yes, no) = (fx.b.new_block(), fx.b.new_block());
            build.branch(fx, holds, yes, no);
            fx.b.seal(yes);
            fx.b.seal(no);
            fx.b.switch_to(yes);
            let text = build.emit_text(fx, text);
            fx.b.write(received, text);
            fx.b.jump(described);
            fx.b.switch_to(no);
        };
        let null = self.emit(fx, Op::Null);
        let is_null = self.emit(fx, Op::StrictEq { a: value, b: null });
        says(self, fx, is_null, b"null");
        let is_array = self.emit_global_method_call(fx, b"Array", b"isArray", &[value]);
        says(self, fx, is_array, b"array");
        let kind = self.emit(fx, Op::TypeOf(value));
        fx.b.write(received, kind);
        let is_number = self.emit_typeof_test(fx, value, b"number");
        self.continue_if(fx, is_number, described);
        let is_finite = self.emit_global_method_call(fx, b"Number", b"isFinite", &[value]);
        self.continue_unless(fx, is_finite, described);
        let is_nan = self.emit_global_method_call(fx, b"Number", b"isNaN", &[value]);
        says(self, fx, is_nan, b"nan");
        let infinity = self.emit_text(fx, b"infinity");
        fx.b.write(received, infinity);
        fx.b.jump(described);
        fx.b.seal(described);
        fx.b.switch_to(described);
        let received = fx.b.read(received);

        let text = self.new_temporary(fx);
        fx.b.write(text, message);
        let worded = fx.b.new_block();
        let is_unwritten = self.emit(fx, Op::StrictEq { a: message, b: null });
        self.continue_if(fx, is_unwritten, worded);
        let (with_received, others) = (fx.b.new_block(), fx.b.new_block());
        for name in [&b"invalid_type"[..], b"invalid_value", b"invalid_union"] {
            let name = self.emit_text(fx, name);
            let is_it = self.emit(fx, Op::StrictEq { a: code, b: name });
            self.continue_unless(fx, is_it, with_received);
        }
        fx.b.jump(others);
        fx.b.seal(with_received);
        fx.b.seal(others);
        fx.b.switch_to(with_received);
        let head = self.emit_text(fx, b"Invalid input: expected ");
        let middle = self.emit_text(fx, b", received ");
        let written = self.emit_joined(fx, &[head, expected, middle, received]);
        fx.b.write(text, written);
        fx.b.jump(worded);
        fx.b.switch_to(others);
        let name = self.emit_text(fx, b"unrecognized_keys");
        let is_key = self.emit(fx, Op::StrictEq { a: code, b: name });
        let (key, rule) = (fx.b.new_block(), fx.b.new_block());
        self.branch(fx, is_key, key, rule);
        fx.b.seal(key);
        fx.b.seal(rule);
        fx.b.switch_to(key);
        let head = self.emit_text(fx, b"Unrecognized key: ");
        let written = self.emit_joined(fx, &[head, expected]);
        fx.b.write(text, written);
        fx.b.jump(worded);
        fx.b.switch_to(rule);
        let head = self.emit_text(fx, b"Invalid input: expected ");
        let written = self.emit_joined(fx, &[head, expected]);
        fx.b.write(text, written);
        fx.b.jump(worded);
        fx.b.seal(worded);
        fx.b.switch_to(worded);
        let text = fx.b.read(text);
        let issue = self.emit_plain_object(fx, &[(b"path", path), (b"code", code), (b"expected", expected), (b"received", received), (b"message", text)]);
        let push = self.out.strs.intern(b"push");
        self.emit_throwing(fx, Op::CallMethod { obj: issues, name: push, args: [issue].into_iter().collect() });
        self.terminate_with_return(fx, V::NONE);
    }

    fn emit_issue(&mut self, fx: &mut Fx, place: (V, V), code: &[u8], expected: V, value: V, message: &Option<Vec<u8>>) {
        let adder = self.function_made(fx, Made::IssueAdder, 6);
        let code = self.emit_text(fx, code);
        let message = match message {
            Some(message) => self.emit_text(fx, message),
            None => self.emit(fx, Op::Null),
        };
        self.emit_throwing(fx, Op::CallDirect { func: adder, args: [place.1, place.0, code, expected, value, message].into_iter().collect() });
    }

    fn emit_issue_about(&mut self, fx: &mut Fx, place: (V, V), code: &[u8], expected: &[u8], value: V, message: &Option<Vec<u8>>) {
        let expected = self.emit_text(fx, expected);
        self.emit_issue(fx, place, code, expected, value, message);
    }

    fn emit_path_within(&mut self, fx: &mut Fx, path: V, key: V) -> V {
        let longer = self.emit_list(fx, &[]);
        self.operation(fx, Operation::AppendSpread, &[longer, path]);
        let push = self.out.strs.intern(b"push");
        self.emit_throwing(fx, Op::CallMethod { obj: longer, name: push, args: [key].into_iter().collect() });
        longer
    }

    fn emit_shown_constant(&mut self, fx: &mut Fx, constant: &Constant) -> V {
        if *constant == Constant::Undefined {
            return self.emit_text(fx, b"undefined");
        }
        let constant = self.emit_planned_constant(fx, constant);
        self.emit_global_method_call(fx, b"JSON", b"stringify", &[constant])
    }

    fn emit_expected(&mut self, fx: &mut Fx, plan: &ValidationPlan, node: u32) -> V {
        let text: &[u8] = match &plan.nodes[node as usize].planned {
            Planned::Anything => b"unknown",
            Planned::Nothing => b"never",
            Planned::Primitive(primitive) => name_of(*primitive),
            Planned::Value(constant) => return self.emit_shown_constant(fx, constant),
            Planned::Array { .. } => b"array",
            Planned::Tuple { .. } => b"tuple",
            Planned::AnyObject | Planned::Dictionary { .. } | Planned::Object { .. } => b"object",
            Planned::Union { arms, .. } => {
                let mut parts = Vec::with_capacity(arms.len() * 2);
                for (at, &arm) in arms.iter().enumerate() {
                    if at > 0 {
                        parts.push(self.emit_text(fx, b" | "));
                    }
                    parts.push(self.emit_expected(fx, plan, arm));
                }
                return self.emit_joined(fx, &parts);
            }
        };
        self.emit_text(fx, text)
    }

    fn emit_report_of_rules(&mut self, fx: &mut Fx, plan: &ValidationPlan, node: u32, value: V, place: (V, V)) {
        let described = &plan.nodes[node as usize];
        let counts_items = matches!(described.planned, Planned::Array { .. });
        for rule in &described.rules {
            let holds = self.emit_rule(fx, rule, value);
            let (broken, next) = (fx.b.new_block(), fx.b.new_block());
            self.branch(fx, holds, next, broken);
            fx.b.seal(broken);
            fx.b.switch_to(broken);
            let (code, head, number, tail): (&[u8], &[u8], Option<f64>, &[u8]) = match rule {
                Rule::Integer => (b"invalid_type", b"int", None, b""),
                Rule::AtLeast(n) => (b"too_small", b"number to be >=", Some(*n), b""),
                Rule::AtMost(n) => (b"too_big", b"number to be <=", Some(*n), b""),
                Rule::Above(n) => (b"too_small", b"number to be >", Some(*n), b""),
                Rule::Below(n) => (b"too_big", b"number to be <", Some(*n), b""),
                Rule::MultipleOf(n) => (b"not_multiple_of", b"multiple of ", Some(*n), b""),
                Rule::LengthAtLeast(n) if counts_items => (b"too_small", b"array to have >=", Some(*n), b" items"),
                Rule::LengthAtLeast(n) => (b"too_small", b"string to have >=", Some(*n), b" characters"),
                Rule::LengthAtMost(n) if counts_items => (b"too_big", b"array to have <=", Some(*n), b" items"),
                Rule::LengthAtMost(n) => (b"too_big", b"string to have <=", Some(*n), b" characters"),
                Rule::Pattern(pattern) => (b"invalid_format", b"string to match /", None, pattern),
                Rule::Format { name, .. } => (b"invalid_format", name, None, b""),
            };
            let mut parts = vec![self.emit_text(fx, head)];
            if let Some(number) = number {
                parts.push(self.number(fx, number));
            }
            if !tail.is_empty() {
                parts.push(self.emit_text(fx, tail));
            }
            if matches!(rule, Rule::Pattern(_)) {
                parts.push(self.emit_text(fx, b"/"));
            }
            let expected = self.emit_joined(fx, &parts);
            self.emit_issue(fx, place, code, expected, value, &described.message);
            fx.b.jump(next);
            fx.b.seal(next);
            fx.b.switch_to(next);
        }
    }

    fn emit_reporter(&mut self, fx: &mut Fx, number: u32, node: u32) {
        let plan = self.validators.plans[number as usize].clone();
        let [value, path, issues] = std::array::from_fn(|_| self.add_entry_param(fx, Ty::NONE));
        self.validators.is_building_recursive_node = true;
        self.emit_report(fx, &plan, number, node, value, path, issues);
        self.terminate_with_return(fx, V::NONE);
    }

    fn emit_report(&mut self, fx: &mut Fx, plan: &Rc<ValidationPlan>, number: u32, node: u32, input: V, path: V, issues: V) {
        let described = &plan.nodes[node as usize];
        let is_apart = described.is_recursive || matches!(described.planned, Planned::Object { .. });
        if is_apart && !std::mem::take(&mut self.validators.is_building_recursive_node) {
            let reporter = self.function_made(fx, Made::Reporter(number, node), 3);
            self.emit_throwing(fx, Op::CallDirect { func: reporter, args: [input, path, issues].into_iter().collect() });
            return;
        }
        let input = self.emit_with_default(fx, &described.default, input);
        let (place, message) = ((path, issues), &described.message);
        let (wrong, done) = (fx.b.new_block(), fx.b.new_block());
        let (code, expected): (&[u8], &[u8]) = match &described.planned {
            Planned::Anything => (b"", b""),
            Planned::Nothing => {
                fx.b.jump(wrong);
                let unreachable = fx.b.new_block();
                fx.b.seal(unreachable);
                fx.b.switch_to(unreachable);
                (b"invalid_type", b"never")
            }
            Planned::Primitive(primitive) => {
                let is_one = self.emit_typeof_test(fx, input, name_of(*primitive));
                self.continue_if(fx, is_one, wrong);
                if *primitive == PlannedPrimitive::Number {
                    let is_finite = self.emit_global_method_call(fx, b"Number", b"isFinite", &[input]);
                    self.continue_if(fx, is_finite, wrong);
                }
                self.emit_report_of_rules(fx, plan, node, input, place);
                (b"invalid_type", name_of(*primitive))
            }
            Planned::Value(constant) => {
                let wanted = self.emit_planned_constant(fx, constant);
                let is_it = self.emit(fx, Op::StrictEq { a: input, b: wanted });
                let (other, next) = (fx.b.new_block(), fx.b.new_block());
                self.branch(fx, is_it, next, other);
                fx.b.seal(other);
                fx.b.switch_to(other);
                let shown = self.emit_shown_constant(fx, constant);
                self.emit_issue(fx, place, b"invalid_value", shown, input, message);
                fx.b.jump(next);
                fx.b.seal(next);
                fx.b.switch_to(next);
                (b"", b"")
            }
            Planned::AnyObject => {
                self.continue_if_object(fx, input, false, wrong);
                (b"invalid_type", b"object")
            }
            Planned::Array { element, .. } => {
                let is_array = self.emit_global_method_call(fx, b"Array", b"isArray", &[input]);
                self.continue_if(fx, is_array, wrong);
                self.emit_report_of_rules(fx, plan, node, input, place);
                let (plan, element) = (plan.clone(), *element);
                self.emit_loop(fx, input, |build, fx, at, item| {
                    let within = build.emit_path_within(fx, path, at);
                    build.emit_report(fx, &plan, number, element, item, within, issues);
                });
                (b"invalid_type", b"array")
            }
            Planned::Tuple { elements, .. } => {
                let is_array = self.emit_global_method_call(fx, b"Array", b"isArray", &[input]);
                self.continue_if(fx, is_array, wrong);
                let length = self.emit_member(fx, input, b"length");
                let wanted = self.emit(fx, Op::Int(elements.len() as i64));
                let is_whole = self.emit(fx, Op::StrictEq { a: length, b: wanted });
                self.continue_if(fx, is_whole, wrong);
                for (at, &element) in elements.iter().enumerate() {
                    let key = self.emit(fx, Op::Int(at as i64));
                    let item = self.emit_throwing(fx, Op::ElemGet { obj: input, key });
                    let within = self.emit_path_within(fx, path, key);
                    self.emit_report(fx, plan, number, element, item, within, issues);
                }
                (b"invalid_type", b"tuple")
            }
            Planned::Dictionary { held, .. } => {
                self.continue_if_object(fx, input, true, wrong);
                let keys = self.emit_global_method_call(fx, b"Object", b"keys", &[input]);
                let (plan, held) = (plan.clone(), *held);
                self.emit_loop(fx, keys, |build, fx, _, key| {
                    let item = build.emit_throwing(fx, Op::ElemGet { obj: input, key });
                    let within = build.emit_path_within(fx, path, key);
                    build.emit_report(fx, &plan, number, held, item, within, issues);
                });
                (b"invalid_type", b"object")
            }
            Planned::Object { members, others, .. } => {
                self.continue_if_object(fx, input, true, wrong);
                for member in members.iter().filter(|member| !member.is_omitted_when_invalid) {
                    let given = self.emit_member(fx, input, &member.name);
                    let key = self.emit_text(fx, &member.name);
                    let within = self.emit_path_within(fx, path, key);
                    self.emit_report(fx, plan, number, member.node, given, within, issues);
                }
                if *others != OtherKeys::Omitted {
                    let keys = self.emit_global_method_call(fx, b"Object", b"keys", &[input]);
                    let (plan, others) = (plan.clone(), *others);
                    self.emit_loop(fx, keys, |build, fx, _, key| {
                        let is_declared = fx.b.new_block();
                        let described = &plan.nodes[node as usize];
                        let Planned::Object { members, .. } = &described.planned else { return };
                        for member in members {
                            let name = build.emit_text(fx, &member.name);
                            let is_it = build.emit(fx, Op::StrictEq { a: key, b: name });
                            build.continue_unless(fx, is_it, is_declared);
                        }
                        match others {
                            OtherKeys::Kept(held) => {
                                let item = build.emit_throwing(fx, Op::ElemGet { obj: input, key });
                                let within = build.emit_path_within(fx, path, key);
                                build.emit_report(fx, &plan, number, held, item, within, issues);
                            }
                            _ => {
                                let shown = build.emit_global_method_call(fx, b"JSON", b"stringify", &[key]);
                                build.emit_issue(fx, (path, issues), b"unrecognized_keys", shown, input, &described.message);
                            }
                        }
                        fx.b.jump(is_declared);
                        fx.b.seal(is_declared);
                        fx.b.switch_to(is_declared);
                    });
                }
                (b"invalid_type", b"object")
            }
            Planned::Union { arms, .. } => {
                let refused = fx.b.new_block();
                self.emit_validation(fx, plan, number, node, input, refused);
                fx.b.jump(done);
                fx.b.seal(refused);
                fx.b.switch_to(refused);
                let (near, count) = (self.new_selector(fx), self.new_selector(fx));
                let none = self.emit(fx, Op::Int(0));
                fx.b.write(near, none);
                fx.b.write(count, none);
                for (at, &arm) in arms.iter().enumerate() {
                    let (is_far, is_near) = (fx.b.new_block(), fx.b.new_block());
                    match &plan.nodes[arm as usize].planned {
                        Planned::Primitive(primitive) => {
                            let is_one = self.emit_typeof_test(fx, input, name_of(*primitive));
                            self.continue_if(fx, is_one, is_far);
                            if *primitive == PlannedPrimitive::Number {
                                let is_finite = self.emit_global_method_call(fx, b"Number", b"isFinite", &[input]);
                                self.continue_if(fx, is_finite, is_far);
                            }
                        }
                        Planned::Array { .. } | Planned::Tuple { .. } => {
                            let is_array = self.emit_global_method_call(fx, b"Array", b"isArray", &[input]);
                            self.continue_if(fx, is_array, is_far);
                        }
                        Planned::Dictionary { .. } | Planned::Object { .. } => self.continue_if_object(fx, input, true, is_far),
                        _ => {
                            fx.b.jump(is_far);
                            let unreachable = fx.b.new_block();
                            fx.b.seal(unreachable);
                            fx.b.switch_to(unreachable);
                        }
                    }
                    fx.b.jump(is_near);
                    fx.b.seal(is_near);
                    fx.b.switch_to(is_near);
                    let this = self.emit(fx, Op::Int(at as i64));
                    fx.b.write(near, this);
                    let so_far = fx.b.read(count);
                    let one = self.emit(fx, Op::Int(1));
                    let more = self.emit(fx, Op::Binary { op: BinOp::Add, a: so_far, b: one });
                    fx.b.func.values[more.idx()].ty = self.known.int32;
                    fx.b.write(count, more);
                    fx.b.jump(is_far);
                    fx.b.seal(is_far);
                    fx.b.switch_to(is_far);
                }
                let (near, count) = (fx.b.read(near), fx.b.read(count));
                let one = self.emit(fx, Op::Int(1));
                let is_one = self.emit(fx, Op::StrictEq { a: count, b: one });
                let (closely, broadly) = (fx.b.new_block(), fx.b.new_block());
                self.branch(fx, is_one, closely, broadly);
                fx.b.seal(closely);
                fx.b.switch_to(closely);
                let before = self.emit_member(fx, issues, b"length");
                let reported = fx.b.new_block();
                for (at, &arm) in arms.iter().enumerate() {
                    let this = self.emit(fx, Op::Int(at as i64));
                    let is_it = self.emit(fx, Op::StrictEq { a: near, b: this });
                    let (it, other) = (fx.b.new_block(), fx.b.new_block());
                    self.branch(fx, is_it, it, other);
                    fx.b.seal(it);
                    fx.b.seal(other);
                    fx.b.switch_to(it);
                    self.emit_report(fx, plan, number, arm, input, path, issues);
                    fx.b.jump(reported);
                    fx.b.switch_to(other);
                }
                fx.b.jump(reported);
                fx.b.seal(reported);
                fx.b.switch_to(reported);
                let after = self.emit_member(fx, issues, b"length");
                let has_said_it = self.emit_throwing(fx, Op::Relational { op: RelOp::Gt, a: after, b: before });
                self.branch(fx, has_said_it, done, broadly);
                fx.b.seal(broadly);
                fx.b.switch_to(broadly);
                let expected = self.emit_expected(fx, plan, node);
                let is_several = self.emit_throwing(fx, Op::Relational { op: RelOp::Gt, a: count, b: one });
                let (several, few) = (fx.b.new_block(), fx.b.new_block());
                self.branch(fx, is_several, several, few);
                fx.b.seal(several);
                fx.b.seal(few);
                fx.b.switch_to(several);
                self.emit_issue(fx, place, b"invalid_union", expected, input, message);
                fx.b.jump(done);
                fx.b.switch_to(few);
                self.emit_issue(fx, place, b"invalid_type", expected, input, message);
                (b"", b"")
            }
        };
        fx.b.jump(done);
        fx.b.seal(wrong);
        fx.b.switch_to(wrong);
        if !code.is_empty() {
            self.emit_issue_about(fx, place, code, expected, input, message);
        }
        fx.b.jump(done);
        fx.b.seal(done);
        fx.b.switch_to(done);
    }
}

fn name_of(primitive: PlannedPrimitive) -> &'static [u8] {
    match primitive {
        PlannedPrimitive::Text => b"string",
        PlannedPrimitive::Number => b"number",
        PlannedPrimitive::Boolean => b"boolean",
        PlannedPrimitive::BigInt => b"bigint",
    }
}
