use super::fit::Ty;
use super::{FileBuild, Fx, Problem, Source};
use crate::id::{BlockId, FuncId, GlobalId, TyId, V};
use crate::ir::{self, Args, BinOp, Op, Operation, RelOp, Term, CoerceReason};
use bun_sema::check::{Constant, OtherKeys, Placeholder, Planned, PlannedPrimitive, Rule, ValidationCall, ValidationPlan};
use bun_sema::hir::{CallId, ExprId, ExprKind};
use bun_sema::types::TypeId;
use rustc_hash::FxHashMap;
use std::borrow::Cow;
use std::rc::Rc;

mod parse;

#[derive(Copy, Clone, PartialEq, Eq, Hash)]
enum GeneratedFunction {
    Validator(u32, u32),
    Parser(u32, u32),
    SchemaValidator(u32),
    Failure(u32),
    SchemaFailure(u32),
    Refusal(u32),
    TemplateMatcher(u32),
}

const BIGINT_TEXT_PATTERN: &[u8] = b"^-?(?:0|[1-9][0-9]*|0[xX][0-9a-fA-F]+|0[oO][0-7]+|0[bB][01]+)$";

fn discriminated_arms(plan: &ValidationPlan, arms: &[u32]) -> Option<(Vec<u8>, Vec<(Constant, u32)>)> {
    let mut objects = Vec::new();
    for &arm in arms {
        match &plan.nodes[arm as usize].planned {
            Planned::Object { members, .. } => objects.push((arm, members)),
            Planned::Primitive(_) | Planned::Value(_) | Planned::Array { .. } | Planned::Tuple { .. } | Planned::Nothing => {}
            _ => return None,
        }
    }
    if objects.len() < 2 {
        return None;
    }
    let constant_under = |members: &[bun_sema::check::PlannedMember], name: &[u8]| {
        let member = members.iter().find(|member| member.name == name && !member.is_optional)?;
        match &plan.nodes[member.node as usize] {
            described if !described.rules.is_empty() || described.default.is_some() => None,
            described => match &described.planned {
                Planned::Value(constant) if *constant != Constant::Undefined => Some(constant.clone()),
                _ => None,
            },
        }
    };
    objects[0].1.iter().find_map(|member| {
        let tagged: Vec<(Constant, u32)> = objects.iter().map(|(arm, members)| Some((constant_under(members, &member.name)?, *arm))).collect::<Option<_>>()?;
        let are_distinct = tagged.iter().enumerate().all(|(at, one)| !tagged[..at].iter().any(|other| other.0 == one.0));
        are_distinct.then(|| (member.name.clone(), tagged))
    })
}

fn utf16_length(text: &[u8]) -> i64 {
    String::from_utf8_lossy(text).encode_utf16().count() as i64
}

#[derive(Default)]
pub(crate) struct Validators {
    plans: Vec<Rc<ValidationPlan>>,
    plan_numbers: FxHashMap<(TypeId, bool), u32>,
    functions: FxHashMap<GeneratedFunction, FuncId>,
    functions_by_type: FxHashMap<(TypeId, bool, bool, bool), GeneratedFunction>,
    sources: Vec<GeneratedFunction>,
    rejection_marker: Option<GlobalId>,
    is_building_recursive_node: bool,
    is_at_call_site: bool,
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
        let is_parse = which == ValidationCall::Parse;
        let number = match self.validators.plan_numbers.get(&(ty, is_parse)) {
            Some(&known) => known,
            None => {
                let number = self.validators.plans.len() as u32;
                let plan = Rc::new(self.c.validation_plan(ty, is_parse));
                self.validators.plans.push(plan);
                self.validators.plan_numbers.insert((ty, is_parse), number);
                number
            }
        };
        let plan = self.validators.plans[number as usize].clone();
        if let Some(first) = plan.unsupported.first() {
            self.problems.push(Problem { file: fx.file, pos, what: Cow::Owned(format!("a type that cannot be validated: {first}")) });
            return Some(self.emit(fx, Op::Undefined));
        }
        if self.shared.constants.records_spans {
            let mut noted = vec![b'0' + which as u8];
            noted.extend_from_slice(&plan.to_json());
            let value = self.emit_text(fx, &noted);
            fx.operand_spans.push(ir::Span { value, start: hir[e].pos, end: hir[e].end, step: crate::audit::VALIDATION });
        }
        let made = self.ty_of(ty);
        let to = self.cast_target_ty(made);
        self.record_cast(Ty { id: self.out.tys.anything, checked: TypeId::UNKNOWN }, to, CoerceReason::Coerce);
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
        let [given] = arguments[..] else { return Some(self.unsupported(fx, pos, "a validation call without exactly one argument")) };
        if matches!(hir[given].kind, ExprKind::Spread(_)) {
            return Some(self.unsupported(fx, pos, "a validation call with a spread argument"));
        }
        let mut value = self.expr(fx, given);
        if which == ValidationCall::Parse && parse::is_parsed_by_type(&plan) {
            return Some(self.emit_parse_by_type(fx, &plan, number, value, Ty { id: made, checked: ty }));
        }
        if which == ValidationCall::Parse {
            value = self.emit_global_method_call(fx, b"JSON", b"parse", &[value]);
        }
        if which == ValidationCall::SafeValidate {
            let declared = self.c.type_of_expr(fx.file, e);
            let result = Ty { id: self.ty_of(declared), checked: declared };
            self.validators.safe_result_types.insert(number, declared);
            return Some(self.emit_root_validation(fx, &plan, number, Some(result), value, true));
        }
        let validated = self.emit_root_validation(fx, &plan, number, None, value, which != ValidationCall::Parse);
        Some(self.coerce_to(fx, validated, Ty { id: made, checked: ty }, CoerceReason::Cast))
    }

    fn emit_safe_result(&mut self, fx: &mut Fx, declared: Option<TypeId>, is_success: bool, name: &[u8], value: V) -> V {
        let success = self.emit(fx, Op::Bool(is_success));
        let names = [self.out.strs.intern(b"success"), self.out.strs.intern(name)];
        for member in declared.map(|declared| self.c.parts(declared).to_vec()).unwrap_or_default() {
            if self.is_record_type(member)
                && let Some(layout) = self.record_layout(member).filter(|&layout| self.fits(layout, &names))
            {
                return self.emit_typed_object(fx, layout, &names, &[success, value], None);
            }
        }
        self.emit_plain_object(fx, &[(b"success", success), (name, value)])
    }

    fn emit_root_validation(&mut self, fx: &mut Fx, plan: &Rc<ValidationPlan>, number: u32, safe_result: Option<Ty>, value: V, is_hot: bool) -> V {
        let (fails, done) = (fx.b.new_block(), fx.b.new_block());
        self.validators.is_at_call_site = is_hot && !self.validators.plans_with_inlined_root.contains(&number);
        if self.validators.is_at_call_site {
            self.validators.plans_with_inlined_root.push(number);
        }
        let checked = self.emit_validation(fx, plan, number, plan.root, value, fails);
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
        let refused = self.emit_rejection(fx, GeneratedFunction::Failure(number), value);
        let refused = self.claim_type(fx, refused, safe_result.id);
        fx.b.write(result, refused);
        fx.b.jump(done);
        fx.b.seal(done);
        fx.b.switch_to(done);
        fx.b.read(result)
    }

    fn hidden_variable(&mut self, fx: &Fx, name: &[u8]) -> GlobalId {
        let name = self.out.strs.intern(name);
        let key = self.next_hidden_variable_key();
        let variable = self.add_global(name, fx.file, Ty::NONE, key);
        self.out.globals[variable.idx()].initialization = ir::Initialization::Undefined;
        variable
    }

    fn emit_initialized_once(&mut self, fx: &mut Fx, variable: GlobalId, make: impl FnOnce(&mut Self, &mut Fx) -> V) -> V {
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
        self.emit_throwing(fx, Op::Coerce { value, to, why: CoerceReason::Claim })
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
        let text = self.add_entry_param(fx, Ty::of(self.known.string));
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
        if described.is_recursive && !std::mem::take(&mut self.validators.is_building_recursive_node) {
            let function = self.validator_for(fx, number, node, TypeId::UNRESOLVED);
            let made = self.emit_throwing(fx, Op::CallDirect { func: function, args: [input].into_iter().collect() });
            let mark = self.emit_rejection_marker(fx);
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
                let list = self.coerce_to(fx, list, want, CoerceReason::Cast);
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
                self.coerce_to(fx, made, want, CoerceReason::Cast)
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
            Planned::Object { .. } if is_at_call_site => self.emit_object(fx, plan, number, node, input, fails),
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
                let mut arms = arms.clone();
                if let Some((name, tagged)) = discriminated_arms(plan, &arms) {
                    let is_no_object = fx.b.new_block();
                    self.continue_if_object(fx, input, true, is_no_object);
                    let tag = self.emit_member(fx, input, &name);
                    for (constant, arm) in &tagged {
                        let (matches, differs) = (fx.b.new_block(), fx.b.new_block());
                        let wanted = self.emit_planned_constant(fx, constant);
                        let is_it = self.emit(fx, Op::StrictEq { a: tag, b: wanted });
                        self.branch(fx, is_it, matches, differs);
                        fx.b.seal(matches);
                        fx.b.seal(differs);
                        fx.b.switch_to(matches);
                        let checked = self.emit_validation(fx, plan, number, *arm, input, fails);
                        fx.b.write(result, checked);
                        fx.b.jump(done);
                        fx.b.switch_to(differs);
                    }
                    fx.b.jump(fails);
                    fx.b.seal(is_no_object);
                    fx.b.switch_to(is_no_object);
                    arms.retain(|arm| !tagged.iter().any(|tagged| tagged.1 == *arm));
                    if arms.is_empty() {
                        fx.b.jump(fails);
                    }
                }
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
        let function = self.helper_function(fx, GeneratedFunction::Validator(number, node), 1);
        if ty != TypeId::UNRESOLVED {
            let made = self.ty_of(ty);
            self.out.funcs[function.idx()].result = self.or_undefined(made);
        }
        function
    }

    fn first_emitted_for_same_type(&mut self, made: GeneratedFunction) -> GeneratedFunction {
        let (number, node, is_parser) = match made {
            GeneratedFunction::Validator(number, node) => (number, node, false),
            GeneratedFunction::Parser(number, node) => (number, node, true),
            _ => return made,
        };
        match self.validators.plans[number as usize].node_identity(node) {
            Some((ty, is_strict, omits_members)) => *self.validators.functions_by_type.entry((ty, is_strict, omits_members, is_parser)).or_insert(made),
            None => made,
        }
    }

    fn helper_function(&mut self, fx: &Fx, made: GeneratedFunction, parameters: u16) -> FuncId {
        let made = self.first_emitted_for_same_type(made);
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
            GeneratedFunction::Validator(number, node) => (number, node),
            GeneratedFunction::Parser(number, node) => return self.emit_parser(fx, number, node),
            GeneratedFunction::SchemaValidator(number) => return self.emit_schema_validator(fx, number),
            made @ (GeneratedFunction::Failure(number) | GeneratedFunction::SchemaFailure(number) | GeneratedFunction::Refusal(number)) => return self.emit_type_mismatch_result(fx, made, number),
            GeneratedFunction::TemplateMatcher(index) => return self.emit_template_matcher(fx, index),
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
            let mark = self.emit_rejection_marker(fx);
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
        self.emit_object_from_checked_members(fx, plan, number, node, Some(value), &checked, fails)
    }

    fn emit_object_from_checked_members(&mut self, fx: &mut Fx, plan: &Rc<ValidationPlan>, number: u32, node: u32, source: Option<V>, checked: &[V], fails: BlockId) -> V {
        let Planned::Object { ty, members, others } = &plan.nodes[node as usize].planned else { return self.emit(fx, Op::Undefined) };
        let (mut names, mut values) = (Vec::new(), Vec::new());
        for (member, &checked) in members.iter().zip(checked).filter(|(member, _)| !member.is_optional) {
            names.push(self.out.strs.intern(&member.name));
            values.push(checked);
        }
        let layout = if self.is_record_type(*ty) { self.record_layout(*ty).filter(|&layout| self.fits(layout, &names)) } else { None };
        let made = match layout {
            Some(layout) => self.emit_typed_object(fx, layout, &names, &values, None),
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
                    let want = self.field_type(layout, field);
                    self.coerce_to(fx, checked, want, CoerceReason::Cast)
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
        self.validators.is_at_call_site = true;
        let checked = self.emit_validation(fx, &plan, number, plan.root, value, fails);
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
        self.emit_throwing(fx, Op::Call { callee, this, args: args.iter().copied().collect() })
    }

    fn emit_type_mismatch_result(&mut self, fx: &mut Fx, made: GeneratedFunction, number: u32) {
        let value = self.add_entry_param(fx, Ty::NONE);
        let text = self.validators.plans[number as usize].to_json();
        let variable = self.hidden_variable(fx, b"plan");
        let plan = self.emit_initialized_once(fx, variable, |build, fx| {
            let text = build.emit_text(fx, &text);
            build.emit_global_method_call(fx, b"JSON", b"parse", &[text])
        });
        let answer = match made {
            GeneratedFunction::Failure(_) => {
                let issues = self.call_validation_helper(fx, b"issuesOf", &[plan, value]);
                let declared = self.validators.safe_result_types.get(&number).copied();
                self.emit_safe_result(fx, declared, false, b"issues", issues)
            }
            GeneratedFunction::SchemaFailure(_) => {
                let issues = self.call_validation_helper(fx, b"issuesOf", &[plan, value]);
                self.emit_plain_object(fx, &[(b"issues", issues)])
            }
            _ => self.call_validation_helper(fx, b"throwIssues", &[plan, value]),
        };
        self.terminate_with_return(fx, answer);
    }
}
