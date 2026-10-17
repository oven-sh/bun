use super::super::coerce::Ty;
use super::super::{FileBuild, Fx};
use super::GeneratedFunction;
use crate::builder::Var;
use crate::declared::Declared;
use crate::id::{BlockId, FuncId, TyId, V};
use crate::ir::{Args, BinOp, CoerceReason, Op, Operation, RelOp, Target, Term};
use bun_sema::check::{
    Constant, OtherKeys, Planned, PlannedMember, PlannedPrimitive, Rule, ValidationPlan,
};
use bun_sema::types::TypeId;
use std::rc::Rc;

const MEMBERS_PER_MASK: usize = 30;
const MAX_KEYS_COMPARED_SEQUENTIALLY: usize = 3;
const MAX_KEY_BYTE_INSPECTED: usize = 32;
const MAX_MEMBERS_PARSED_IN_PLACE: usize = 240;
const OBJECT_PROTOTYPE_PROPERTIES: [&[u8]; 12] = [
    b"constructor",
    b"hasOwnProperty",
    b"isPrototypeOf",
    b"propertyIsEnumerable",
    b"toLocaleString",
    b"toString",
    b"valueOf",
    b"__proto__",
    b"__defineGetter__",
    b"__defineSetter__",
    b"__lookupGetter__",
    b"__lookupSetter__",
];

fn needs_no_escaping(text: &[u8]) -> bool {
    text.iter()
        .all(|&byte| (0x20..0x7f).contains(&byte) && byte != b'"' && byte != b'\\')
}

fn is_parsed_in_place(plan: &ValidationPlan, node: u32) -> bool {
    match &plan.nodes[node as usize].planned {
        Planned::Anything | Planned::AnyObject => false,
        Planned::Value(Constant::Text(text)) => needs_no_escaping(text),
        Planned::Object { members, .. } => {
            members.len() <= MAX_MEMBERS_PARSED_IN_PLACE
                && members.iter().all(|member| {
                    needs_no_escaping(&member.name)
                        && !OBJECT_PROTOTYPE_PROPERTIES.contains(&&member.name[..])
                })
        }
        _ => true,
    }
}

fn opening_byte(plan: &ValidationPlan, node: u32) -> Option<u8> {
    match plan.nodes[node as usize].planned {
        Planned::Primitive(PlannedPrimitive::Text) => Some(b'"'),
        Planned::Dictionary { .. } => Some(b'{'),
        Planned::Object { .. } if is_parsed_in_place(plan, node) => Some(b'{'),
        Planned::Array { .. } | Planned::Tuple { .. } => Some(b'['),
        _ => None,
    }
}

fn reaches(plan: &ValidationPlan, from: u32, target: u32, seen: &mut Vec<u32>) -> bool {
    let within: Vec<u32> = match &plan.nodes[from as usize].planned {
        Planned::Array { element: one, .. } | Planned::Dictionary { held: one, .. } => vec![*one],
        Planned::Tuple {
            elements: several, ..
        }
        | Planned::Union { arms: several, .. } => several.clone(),
        Planned::Object {
            members, others, ..
        } => members
            .iter()
            .map(|member| member.node)
            .chain(if let OtherKeys::Kept(held) = others {
                Some(*held)
            } else {
                None
            })
            .collect(),
        _ => Vec::new(),
    };
    within.into_iter().any(|next| {
        next == target || {
            let is_new = !seen.contains(&next);
            seen.push(next);
            is_new && reaches(plan, next, target, seen)
        }
    })
}

fn discriminating_prefixes(plan: &ValidationPlan, arms: &[u32]) -> Option<Vec<Vec<u8>>> {
    let members_of = |arm: u32| match &plan.nodes[arm as usize].planned {
        Planned::Object { members, .. } if is_parsed_in_place(plan, arm) => Some(members),
        _ => None,
    };
    let source_slice = |arm: u32, name: &[u8]| {
        let member = members_of(arm)?
            .iter()
            .find(|member| member.name == name && !member.is_optional)?;
        match &plan.nodes[member.node as usize] {
            described if !described.rules.is_empty() || described.default.is_some() => None,
            described => match &described.planned {
                Planned::Value(Constant::Text(text)) if needs_no_escaping(text) => Some(text),
                _ => None,
            },
        }
    };
    members_of(*arms.first()?)?.iter().find_map(|member| {
        let texts: Vec<&Vec<u8>> = arms
            .iter()
            .map(|&arm| source_slice(arm, &member.name))
            .collect::<Option<_>>()?;
        let are_distinct = texts
            .iter()
            .enumerate()
            .all(|(at, text)| !texts[..at].contains(text));
        are_distinct.then(|| {
            texts
                .iter()
                .map(|text| [b"{\"", &member.name[..], b"\":\"", &text[..], b"\""].concat())
                .collect()
        })
    })
}

fn may_accept_undefined(plan: &ValidationPlan, node: u32, depth: u32) -> bool {
    let described = &plan.nodes[node as usize];
    described.default.is_some()
        || match &described.planned {
            Planned::Anything | Planned::Value(Constant::Undefined) => true,
            Planned::Union { arms, .. } => {
                depth > 8
                    || arms
                        .iter()
                        .any(|&arm| may_accept_undefined(plan, arm, depth + 1))
            }
            _ => false,
        }
}

fn may_have_default(plan: &ValidationPlan, node: u32, depth: u32) -> bool {
    let described = &plan.nodes[node as usize];
    described.default.is_some()
        || match &described.planned {
            Planned::Union { arms, .. } => {
                depth > 8
                    || arms
                        .iter()
                        .any(|&arm| may_have_default(plan, arm, depth + 1))
            }
            _ => false,
        }
}

fn is_always_present(plan: &ValidationPlan, member: &PlannedMember) -> bool {
    !member.is_optional && !may_accept_undefined(plan, member.node, 0)
}

pub(super) fn is_parsed_by_type(plan: &ValidationPlan) -> bool {
    is_parsed_in_place(plan, plan.root)
}

#[derive(Copy, Clone, PartialEq, Eq)]
enum Found {
    Opened,
    Expected,
    OneOfSeveral,
}

struct ObjectParse {
    cursor: Var,
    held: Vec<Var>,
    seen: Vec<Var>,
    bits: Vec<Option<(usize, i64)>>,
    kept_keys: Var,
    kept_values: Var,
    failed_at: Var,
    failed_name: Var,
    refusal: BlockId,
}

impl<'c, 'p, 's> FileBuild<'c, 'p, 's> {
    fn emit_parser_operation(&mut self, fx: &mut Fx, which: Operation, args: &[V], ty: TyId) -> V {
        let value = self.emit(
            fx,
            Op::Operation {
                which,
                args: args.iter().copied().collect(),
            },
        );
        fx.b.func.values[value.idx()].ty = ty;
        value
    }

    fn advance(&mut self, fx: &mut Fx, cursor: V, by: usize) -> V {
        let by = self.emit(fx, Op::Int(by as i64));
        let moved = self.emit(
            fx,
            Op::Binary {
                op: BinOp::Add,
                a: cursor,
                b: by,
            },
        );
        fx.b.func.values[moved.idx()].ty = self.known.counter;
        moved
    }

    fn skip_whitespace(&mut self, fx: &mut Fx, cursor: V) -> V {
        self.emit_parser_operation(
            fx,
            Operation::JSONSkipWhitespace,
            &[cursor],
            self.known.counter,
        )
    }

    fn branch_on_text(
        &mut self,
        fx: &mut Fx,
        cursor: V,
        text: &[u8],
        is_expected: bool,
        then: BlockId,
        otherwise: BlockId,
    ) {
        let text = self.emit_text(fx, text);
        let is_expected = self.emit(fx, Op::Int(i64::from(is_expected)));
        let holds = self.emit_parser_operation(
            fx,
            Operation::JSONStartsWith,
            &[cursor, text, is_expected],
            self.known.boolean,
        );
        fx.b.branch(holds, then, otherwise);
    }

    fn continue_after_text(
        &mut self,
        fx: &mut Fx,
        cursor: V,
        text: &[u8],
        is_expected: bool,
        otherwise: BlockId,
    ) -> V {
        let next = fx.b.new_block();
        self.branch_on_text(fx, cursor, text, is_expected, next, otherwise);
        fx.b.seal(next);
        fx.b.switch_to(next);
        self.advance(fx, cursor, text.len())
    }

    fn continue_if_parsed(&mut self, fx: &mut Fx, cursor: V, otherwise: BlockId) {
        let zero = self.emit(fx, Op::Int(0));
        let is_one = self.emit(
            fx,
            Op::Relational {
                op: RelOp::Gt,
                a: cursor,
                b: zero,
            },
        );
        let is_one =
            self.emit_parser_operation(fx, Operation::Likely, &[is_one], self.known.boolean);
        let next = fx.b.new_block();
        fx.b.branch(is_one, next, otherwise);
        fx.b.seal(next);
        fx.b.switch_to(next);
    }

    fn continue_after_parsed_value(&mut self, fx: &mut Fx, otherwise: BlockId) -> V {
        let cursor = self.emit_parser_operation(fx, Operation::JSONCursor, &[], self.known.counter);
        self.continue_if_parsed(fx, cursor, otherwise);
        cursor
    }

    fn exact_integer(&mut self) -> TyId {
        self.out.tys.intern(Declared::ints(-(1 << 53), 1 << 53))
    }

    fn emit_parsed_number(&mut self, fx: &mut Fx, cursor: V, fails: BlockId) -> (V, V) {
        let end =
            self.emit_parser_operation(fx, Operation::JSONNumberAt, &[cursor], self.known.counter);
        self.continue_if_parsed(fx, end, fails);
        (
            self.emit_parser_operation(fx, Operation::JSONNumber, &[], self.known.number),
            end,
        )
    }

    fn continue_after_text_and_whitespace(
        &mut self,
        fx: &mut Fx,
        cursor: V,
        text: &[u8],
        fails: BlockId,
    ) -> V {
        let end = fx.b.new_var(self.known.counter);
        let (at_once, otherwise, next) = (fx.b.new_block(), fx.b.new_block(), fx.b.new_block());
        self.branch_on_text(fx, cursor, text, true, at_once, otherwise);
        fx.b.seal(at_once);
        fx.b.seal(otherwise);
        fx.b.switch_to(at_once);
        let after = self.advance(fx, cursor, text.len());
        fx.b.write(end, after);
        fx.b.jump(next);
        fx.b.switch_to(otherwise);
        let moved = self.skip_whitespace(fx, cursor);
        let after = self.continue_after_text(fx, moved, text, true, fails);
        fx.b.write(end, after);
        fx.b.jump(next);
        fx.b.seal(next);
        fx.b.switch_to(next);
        let after = fx.b.read(end);
        self.skip_whitespace(fx, after)
    }

    fn branch_on_separator(
        &mut self,
        fx: &mut Fx,
        cursor: Var,
        closer: &[u8],
        continues: BlockId,
        ends: BlockId,
        fails: BlockId,
    ) {
        let head = fx.b.new_block();
        fx.b.jump(head);
        fx.b.switch_to(head);
        let at = fx.b.read(cursor);
        let (has_comma, has_none, closes, neither, again) = (
            fx.b.new_block(),
            fx.b.new_block(),
            fx.b.new_block(),
            fx.b.new_block(),
            fx.b.new_block(),
        );
        self.branch_on_text(fx, at, b",", false, has_comma, has_none);
        fx.b.seal(has_comma);
        fx.b.seal(has_none);
        fx.b.switch_to(has_comma);
        let next = self.advance(fx, at, 1);
        let next = self.skip_whitespace(fx, next);
        fx.b.write(cursor, next);
        fx.b.jump(continues);
        fx.b.switch_to(has_none);
        self.branch_on_text(fx, at, closer, false, closes, neither);
        fx.b.seal(closes);
        fx.b.seal(neither);
        fx.b.switch_to(closes);
        let after = self.advance(fx, at, 1);
        fx.b.write(cursor, after);
        fx.b.jump(ends);
        fx.b.switch_to(neither);
        let moved = self.skip_whitespace(fx, at);
        let has_moved = self.emit(
            fx,
            Op::Relational {
                op: RelOp::Gt,
                a: moved,
                b: at,
            },
        );
        fx.b.branch(has_moved, again, fails);
        fx.b.seal(again);
        fx.b.switch_to(again);
        fx.b.write(cursor, moved);
        fx.b.jump(head);
        fx.b.seal(head);
    }

    fn jump_to_unreachable(&mut self, fx: &mut Fx, to: BlockId) {
        fx.b.jump(to);
        let unreachable = fx.b.new_block();
        fx.b.seal(unreachable);
        fx.b.switch_to(unreachable);
    }

    pub(super) fn emit_parse_by_type(
        &mut self,
        fx: &mut Fx,
        plan: &Rc<ValidationPlan>,
        number: u32,
        text: V,
        created: Ty,
    ) -> V {
        let (general_path, done) = (fx.b.new_block(), fx.b.new_block());
        let result = fx.b.new_var(self.or_anything(created.id));
        let opened =
            self.emit_parser_operation(fx, Operation::JSONOpen, &[text], self.known.counter);
        self.continue_if_parsed(fx, opened, general_path);
        let start = self.skip_whitespace(fx, opened);
        let was_speculative = std::mem::replace(&mut self.validators.is_speculative, true);
        let (value, end) = self.emit_parsed(
            fx,
            plan,
            number,
            plan.root,
            start,
            Found::Expected,
            general_path,
        );
        self.validators.is_speculative = was_speculative;
        let is_complete =
            self.emit_parser_operation(fx, Operation::JSONClose, &[end], self.known.boolean);
        let complete = fx.b.new_block();
        fx.b.branch(is_complete, complete, general_path);
        fx.b.seal(complete);
        fx.b.switch_to(complete);
        let value = self.coerce_to(fx, value, created, CoerceReason::Cast);
        fx.b.write(result, value);
        fx.b.jump(done);
        fx.b.seal(general_path);
        fx.b.switch_to(general_path);
        self.emit_parser_operation(fx, Operation::JSONAbandon, &[], self.known.undefined);
        let text = self.emit_parser_operation(
            fx,
            Operation::JSONDecodeSource,
            &[text],
            self.out.tys.anything,
        );
        let parsed = self.emit_global_method_call(fx, b"JSON", b"parse", &[text]);
        let validated = self.emit_root_validation(fx, plan, number, None, parsed, false);
        let validated = self.coerce_to(fx, validated, created, CoerceReason::Cast);
        fx.b.write(result, validated);
        fx.b.jump(done);
        fx.b.seal(done);
        fx.b.switch_to(done);
        fx.b.read(result)
    }

    pub(super) fn emit_exact_parse(
        &mut self,
        fx: &mut Fx,
        plan: &Rc<ValidationPlan>,
        number: u32,
        source: V,
    ) -> V {
        let (general_path, done) = (fx.b.new_block(), fx.b.new_block());
        let result = self.new_temporary(fx);
        let is_text = self.emit_typeof_test(fx, source, b"string");
        self.continue_if(fx, is_text, general_path);
        let text = self.claim_type(fx, source, self.known.string);
        let (char_code_at, one, space) = (
            self.out.strs.intern(b"charCodeAt"),
            self.emit(fx, Op::Int(1)),
            self.emit(fx, Op::Int(0x20)),
        );
        let second = self.emit_throwing(
            fx,
            Op::CallMethod {
                obj: text,
                name: char_code_at,
                args: [one].into_iter().collect(),
            },
        );
        let is_compact = self.emit(
            fx,
            Op::Relational {
                op: RelOp::Gt,
                a: second,
                b: space,
            },
        );
        self.continue_if(fx, is_compact, general_path);
        let opened =
            self.emit_parser_operation(fx, Operation::JSONOpen, &[source], self.known.counter);
        self.continue_if_parsed(fx, opened, general_path);
        let was_speculative = std::mem::replace(&mut self.validators.is_speculative, true);
        let (value, end) = self.emit_parsed(
            fx,
            plan,
            number,
            plan.root,
            opened,
            Found::Expected,
            general_path,
        );
        self.validators.is_speculative = was_speculative;
        let is_complete =
            self.emit_parser_operation(fx, Operation::JSONClose, &[end], self.known.boolean);
        let complete = fx.b.new_block();
        fx.b.branch(is_complete, complete, general_path);
        fx.b.seal(complete);
        fx.b.switch_to(complete);
        fx.b.write(result, value);
        fx.b.jump(done);
        fx.b.seal(general_path);
        fx.b.switch_to(general_path);
        self.emit_parser_operation(fx, Operation::JSONAbandon, &[], self.known.undefined);
        let parsed = self.emit_global_method_call(fx, b"JSON", b"parse", &[source]);
        fx.b.write(result, parsed);
        fx.b.jump(done);
        fx.b.seal(done);
        fx.b.switch_to(done);
        fx.b.read(result)
    }

    fn emit_compact_object_parser(
        &mut self,
        fx: &mut Fx,
        plan: &Rc<ValidationPlan>,
        number: u32,
        node: u32,
        start: V,
        malformed: BlockId,
    ) {
        let Planned::Object { members, .. } = &plan.nodes[node as usize].planned else {
            return;
        };
        let is_recursive = reaches(plan, node, node, &mut Vec::new());
        let fails = if is_recursive {
            malformed
        } else {
            fx.b.new_block()
        };
        let cursor = fx.b.new_var(self.known.counter);
        fx.b.write(cursor, start);
        let has_members = self.new_flag(fx);
        let no = self.emit(fx, Op::Bool(false));
        fx.b.write(has_members, no);
        let undefined = self.emit(fx, Op::Undefined);
        let mut values = Vec::with_capacity(members.len());
        let mut follows_member = false;
        for (at, member) in members.iter().enumerate() {
            let opener = opening_byte(plan, member.node);
            let key = [b"\"", &member.name[..], b"\":", opener.as_slice()].concat();
            let held = self.new_temporary(fx);
            fx.b.write(held, undefined);
            let next = fx.b.new_block();
            let absent = if member.is_optional { next } else { fails };
            let before = fx.b.read(cursor);
            let within = if follows_member {
                self.continue_after_text(
                    fx,
                    before,
                    &[b",", &key[..]].concat(),
                    !member.is_optional,
                    absent,
                )
            } else if at == 0 {
                self.continue_after_text(fx, before, &key, !member.is_optional, absent)
            } else {
                let key_start = fx.b.new_var(self.known.counter);
                fx.b.write(key_start, before);
                let (after_comma, at_key) = (fx.b.new_block(), fx.b.new_block());
                let follows_member = fx.b.read(has_members);
                fx.b.branch(follows_member, after_comma, at_key);
                fx.b.seal(after_comma);
                fx.b.switch_to(after_comma);
                let after = self.continue_after_text(fx, before, b",", false, absent);
                fx.b.write(key_start, after);
                fx.b.jump(at_key);
                fx.b.seal(at_key);
                fx.b.switch_to(at_key);
                let key_start = fx.b.read(key_start);
                self.continue_after_text(fx, key_start, &key, !member.is_optional, absent)
            };
            let (value, after) =
                self.emit_parsed(fx, plan, number, member.node, within, Found::Opened, fails);
            fx.b.write(held, value);
            fx.b.write(cursor, after);
            if !follows_member {
                let yes = self.emit(fx, Op::Bool(true));
                fx.b.write(has_members, yes);
            }
            fx.b.jump(next);
            fx.b.seal(next);
            fx.b.switch_to(next);
            values.push(fx.b.read(held));
            follows_member |= !member.is_optional;
        }
        let before = fx.b.read(cursor);
        let end = self.continue_after_text(fx, before, b"}", true, fails);
        let created = self.emit(fx, Op::NewObject);
        for (member, &value) in members.iter().zip(&values) {
            let name = self.emit_text(fx, &member.name);
            if !member.is_optional {
                self.operation(fx, Operation::DefineField, &[created, name, value]);
                continue;
            }
            let is_absent = self.emit(
                fx,
                Op::StrictEq {
                    a: value,
                    b: undefined,
                },
            );
            let next = fx.b.new_block();
            self.continue_unless(fx, is_absent, next);
            self.operation(fx, Operation::DefineField, &[created, name, value]);
            fx.b.jump(next);
            fx.b.seal(next);
            fx.b.switch_to(next);
        }
        self.return_parsed(fx, created, end);
        if !is_recursive {
            fx.b.seal(fails);
            fx.b.switch_to(fails);
            let back = self.emit(fx, Op::Int(-1));
            let brace = self.emit(
                fx,
                Op::Binary {
                    op: BinOp::Add,
                    a: start,
                    b: back,
                },
            );
            fx.b.func.values[brace.idx()].ty = self.known.counter;
            let value = self.emit_parser_operation(
                fx,
                Operation::JSONValueAt,
                &[brace],
                self.out.tys.anything,
            );
            let end = self.continue_after_parsed_value(fx, malformed);
            self.return_parsed(fx, value, end);
        }
    }

    fn continue_after_compact_separator(
        &mut self,
        fx: &mut Fx,
        cursor: Var,
        closer: &[u8],
        continues: BlockId,
        fails: BlockId,
    ) {
        let at = fx.b.read(cursor);
        let after = self.advance(fx, at, 1);
        fx.b.write(cursor, after);
        let (ends, done) = (fx.b.new_block(), fx.b.new_block());
        self.branch_on_text(fx, at, b",", false, continues, ends);
        fx.b.seal(ends);
        fx.b.switch_to(ends);
        self.branch_on_text(fx, at, closer, true, done, fails);
        fx.b.seal(done);
        fx.b.switch_to(done);
    }

    fn emit_compact_list_parser(
        &mut self,
        fx: &mut Fx,
        plan: &Rc<ValidationPlan>,
        number: u32,
        held: u32,
        is_dictionary: bool,
        start: V,
        fails: BlockId,
    ) {
        let closer: &[u8] = if is_dictionary { b"}" } else { b"]" };
        let created = if is_dictionary {
            self.emit(fx, Op::NewObject)
        } else {
            self.emit_throwing(fx, Op::NewArray(Args::new()))
        };
        let cursor = fx.b.new_var(self.known.counter);
        fx.b.write(cursor, start);
        let (is_empty, turn, done) = (fx.b.new_block(), fx.b.new_block(), fx.b.new_block());
        self.branch_on_text(fx, start, closer, false, is_empty, turn);
        fx.b.seal(is_empty);
        fx.b.switch_to(is_empty);
        let after = self.advance(fx, start, 1);
        fx.b.write(cursor, after);
        fx.b.jump(done);
        fx.b.switch_to(turn);
        self.emit(fx, Op::Poll);
        let at = fx.b.read(cursor);
        if is_dictionary {
            let key_start = self.continue_after_text(fx, at, b"\"", true, fails);
            let key = self.emit_parser_operation(
                fx,
                Operation::JSONKeyAt,
                &[key_start],
                self.known.string,
            );
            let after_key = self.continue_after_parsed_value(fx, fails);
            let within = self.continue_after_text(fx, after_key, b":", true, fails);
            let (value, after) =
                self.emit_parsed(fx, plan, number, held, within, Found::Expected, fails);
            self.operation(fx, Operation::PutByValDirect, &[created, key, value]);
            fx.b.write(cursor, after);
        } else {
            let (item, after) =
                self.emit_parsed(fx, plan, number, held, at, Found::Expected, fails);
            let push = self.out.strs.intern(b"push");
            self.emit_throwing(
                fx,
                Op::CallMethod {
                    obj: created,
                    name: push,
                    args: [item].into_iter().collect(),
                },
            );
            fx.b.write(cursor, after);
        }
        self.continue_after_compact_separator(fx, cursor, closer, turn, fails);
        fx.b.seal(turn);
        fx.b.jump(done);
        fx.b.seal(done);
        fx.b.switch_to(done);
        let end = fx.b.read(cursor);
        self.return_parsed(fx, created, end);
    }

    fn emit_compact_tuple_parser(
        &mut self,
        fx: &mut Fx,
        plan: &Rc<ValidationPlan>,
        number: u32,
        elements: &[u32],
        start: V,
        fails: BlockId,
    ) {
        let mut cursor = start;
        let mut items = Vec::with_capacity(elements.len());
        for (at, &element) in elements.iter().enumerate() {
            if at > 0 {
                cursor = self.continue_after_text(fx, cursor, b",", true, fails);
            }
            let (item, after) =
                self.emit_parsed(fx, plan, number, element, cursor, Found::Expected, fails);
            items.push(item);
            cursor = after;
        }
        let end = self.continue_after_text(fx, cursor, b"]", true, fails);
        let created = self.emit_list(fx, &items);
        self.return_parsed(fx, created, end);
    }

    fn parser_for(&mut self, fx: &Fx, number: u32, node: u32, ty: TypeId) -> FuncId {
        let function = self.helper_function(fx, GeneratedFunction::Parser(number, node), 1);
        self.out.funcs[function.idx()].params = vec![self.known.counter];
        if ty != TypeId::UNRESOLVED {
            let created = self.ty_of(ty);
            self.out.funcs[function.idx()].result = self.or_undefined(created);
        }
        function
    }

    fn emit_parsed(
        &mut self,
        fx: &mut Fx,
        plan: &Rc<ValidationPlan>,
        number: u32,
        node: u32,
        cursor: V,
        found: Found,
        fails: BlockId,
    ) -> (V, V) {
        let described = &plan.nodes[node as usize];
        if plan.is_exact
            && !is_parsed_in_place(plan, node)
            && matches!(described.planned, Planned::Object { .. })
        {
            self.jump_to_unreachable(fx, fails);
            return (self.emit(fx, Op::Undefined), cursor);
        }
        if !is_parsed_in_place(plan, node) {
            let value = self.emit_parser_operation(
                fx,
                Operation::JSONValueAt,
                &[cursor],
                self.out.tys.anything,
            );
            let end = self.continue_after_parsed_value(fx, fails);
            return (
                self.emit_validation(fx, plan, number, node, value, fails),
                end,
            );
        }
        let cursor = match opening_byte(plan, node) {
            Some(opener) if found != Found::Opened => {
                self.continue_after_text(fx, cursor, &[opener], found == Found::Expected, fails)
            }
            _ => cursor,
        };
        let (value, end) = match &described.planned {
            Planned::Primitive(PlannedPrimitive::Text) => {
                let text = self.emit_parser_operation(
                    fx,
                    Operation::JSONStringAt,
                    &[cursor],
                    self.known.string,
                );
                (text, self.continue_after_parsed_value(fx, fails))
            }
            Planned::Primitive(PlannedPrimitive::Number)
                if described.rules.contains(&Rule::Integer) =>
            {
                let end = self.emit_parser_operation(
                    fx,
                    Operation::JSONIntegerAt,
                    &[cursor],
                    self.known.counter,
                );
                self.continue_if_parsed(fx, end, fails);
                let exact_integer = self.exact_integer();
                let integer =
                    self.emit_parser_operation(fx, Operation::JSONInteger, &[], exact_integer);
                let others: Vec<Rule> = described
                    .rules
                    .iter()
                    .filter(|&rule| *rule != Rule::Integer)
                    .cloned()
                    .collect();
                self.emit_rules(fx, &others, integer, fails);
                return (integer, end);
            }
            Planned::Primitive(PlannedPrimitive::Number) => {
                self.emit_parsed_number(fx, cursor, fails)
            }
            Planned::Primitive(PlannedPrimitive::Boolean) => {
                let (held, end) = (
                    fx.b.new_var(self.known.boolean),
                    fx.b.new_var(self.known.counter),
                );
                let (is_true, is_not_true, done) =
                    (fx.b.new_block(), fx.b.new_block(), fx.b.new_block());
                self.branch_on_text(fx, cursor, b"true", false, is_true, is_not_true);
                fx.b.seal(is_true);
                fx.b.seal(is_not_true);
                fx.b.switch_to(is_true);
                let yes = self.emit(fx, Op::Bool(true));
                let after = self.advance(fx, cursor, 4);
                fx.b.write(held, yes);
                fx.b.write(end, after);
                fx.b.jump(done);
                fx.b.switch_to(is_not_true);
                let after = self.continue_after_text(fx, cursor, b"false", true, fails);
                let no = self.emit(fx, Op::Bool(false));
                fx.b.write(held, no);
                fx.b.write(end, after);
                fx.b.jump(done);
                fx.b.seal(done);
                fx.b.switch_to(done);
                (fx.b.read(held), fx.b.read(end))
            }
            Planned::Value(Constant::Null) => {
                let end = self.continue_after_text(fx, cursor, b"null", false, fails);
                (self.emit(fx, Op::Null), end)
            }
            Planned::Value(Constant::Boolean(value)) => {
                let end = self.continue_after_text(
                    fx,
                    cursor,
                    if *value { b"true" } else { b"false" },
                    false,
                    fails,
                );
                (self.emit(fx, Op::Bool(*value)), end)
            }
            Planned::Value(Constant::Number(wanted)) => {
                let (number, end) = self.emit_parsed_number(fx, cursor, fails);
                let wanted = self.number(fx, *wanted);
                let is_it = self.emit(
                    fx,
                    Op::StrictEq {
                        a: number,
                        b: wanted,
                    },
                );
                self.continue_if(fx, is_it, fails);
                (wanted, end)
            }
            Planned::Value(Constant::Text(wanted)) => {
                let (is_it, is_other) = (fx.b.new_block(), fx.b.new_block());
                let quoted = [b"\"", &wanted[..], b"\""].concat();
                self.branch_on_text(fx, cursor, &quoted, false, is_it, is_other);
                fx.b.seal(is_it);
                fx.b.seal(is_other);
                fx.b.switch_to(is_other);
                self.emit_parser_operation(
                    fx,
                    Operation::JSONGiveUpIfEscaped,
                    &[cursor],
                    self.known.undefined,
                );
                fx.b.jump(fails);
                fx.b.switch_to(is_it);
                let end = self.advance(fx, cursor, quoted.len());
                (self.emit_text(fx, wanted), end)
            }
            Planned::Object { ty, .. }
            | Planned::Array { ty, .. }
            | Planned::Tuple { ty, .. }
            | Planned::Dictionary { ty, .. } => {
                let parser = self.parser_for(
                    fx,
                    number,
                    node,
                    if plan.is_exact || matches!(described.planned, Planned::Dictionary { .. }) {
                        TypeId::UNRESOLVED
                    } else {
                        *ty
                    },
                );
                let created = self.emit_throwing(
                    fx,
                    Op::CallDirect {
                        func: parser,
                        args: [cursor].into_iter().collect(),
                    },
                );
                let undefined = self.emit(fx, Op::Undefined);
                let is_refused = self.emit(
                    fx,
                    Op::StrictEq {
                        a: created,
                        b: undefined,
                    },
                );
                self.continue_unless(fx, is_refused, fails);
                let end =
                    self.emit_parser_operation(fx, Operation::JSONCursor, &[], self.known.counter);
                if matches!(described.planned, Planned::Array { .. }) {
                    return (created, end);
                }
                (created, end)
            }
            Planned::Union { arms, .. } => {
                let (held, end) = (self.new_temporary(fx), fx.b.new_var(self.known.counter));
                let done = fx.b.new_block();
                if let Some(texts) = discriminating_prefixes(plan, arms) {
                    let gives_up = self.give_up(fx, fails);
                    for (&arm, text) in arms.iter().zip(&texts) {
                        let (is_it, is_other) = (fx.b.new_block(), fx.b.new_block());
                        self.branch_on_text(fx, cursor, text, false, is_it, is_other);
                        fx.b.seal(is_it);
                        fx.b.seal(is_other);
                        fx.b.switch_to(is_it);
                        let within = self.advance(fx, cursor, 1);
                        let (value, after) = self.emit_parsed(
                            fx,
                            plan,
                            number,
                            arm,
                            within,
                            Found::Opened,
                            gives_up,
                        );
                        fx.b.write(held, value);
                        fx.b.write(end, after);
                        fx.b.jump(done);
                        fx.b.switch_to(is_other);
                    }
                    fx.b.seal(gives_up);
                }
                for (at, &arm) in arms.iter().enumerate() {
                    let is_last = at + 1 == arms.len();
                    let next = if is_last { fails } else { fx.b.new_block() };
                    let (value, after) =
                        self.emit_parsed(fx, plan, number, arm, cursor, Found::OneOfSeveral, next);
                    fx.b.write(held, value);
                    fx.b.write(end, after);
                    fx.b.jump(done);
                    if !is_last {
                        fx.b.seal(next);
                        fx.b.switch_to(next);
                    }
                }
                fx.b.seal(done);
                fx.b.switch_to(done);
                (fx.b.read(held), fx.b.read(end))
            }
            _ => {
                self.jump_to_unreachable(fx, fails);
                (self.emit(fx, Op::Undefined), cursor)
            }
        };
        self.emit_rules(fx, &described.rules, value, fails);
        (value, end)
    }

    pub(super) fn emit_parser(&mut self, fx: &mut Fx, number: u32, node: u32) {
        let plan = self.validators.plans[number as usize].clone();
        let start = self.add_entry_param(fx, Ty::from_id(self.known.counter));
        let fails = fx.b.new_block();
        let was_speculative = std::mem::replace(&mut self.validators.is_speculative, true);
        if reaches(&plan, node, node, &mut Vec::new()) {
            let has_stack_space = self.emit_parser_operation(
                fx,
                Operation::JSONHasStackSpace,
                &[],
                self.known.boolean,
            );
            let has_stack_space = self.emit_parser_operation(
                fx,
                Operation::Likely,
                &[has_stack_space],
                self.known.boolean,
            );
            let next = fx.b.new_block();
            fx.b.branch(has_stack_space, next, fails);
            fx.b.seal(next);
            fx.b.switch_to(next);
        }
        match &plan.nodes[node as usize].planned {
            Planned::Dictionary { held, .. } if plan.is_exact => {
                self.emit_compact_list_parser(fx, &plan, number, *held, true, start, fails)
            }
            Planned::Array { element, .. } if plan.is_exact => {
                self.emit_compact_list_parser(fx, &plan, number, *element, false, start, fails)
            }
            Planned::Object { .. } if plan.is_exact => {
                self.emit_compact_object_parser(fx, &plan, number, node, start, fails)
            }
            Planned::Tuple { elements, .. } if plan.is_exact => {
                self.emit_compact_tuple_parser(fx, &plan, number, elements, start, fails)
            }
            Planned::Dictionary { held, .. } => {
                self.emit_dictionary_parser(fx, &plan, number, *held, start, fails)
            }
            Planned::Object { .. } => {
                self.emit_object_parser(fx, &plan, number, node, start, fails)
            }
            Planned::Array { ty, element } => {
                self.emit_array_parser(fx, &plan, number, node, *ty, *element, start, fails)
            }
            Planned::Tuple { ty, elements } => {
                self.emit_tuple_parser(fx, &plan, number, *ty, elements, start, fails)
            }
            _ => fx.b.jump(fails),
        }
        self.validators.is_speculative = was_speculative;
        fx.b.seal(fails);
        fx.b.switch_to(fails);
        let undefined = self.emit(fx, Op::Undefined);
        fx.b.terminate(Term::Return(undefined));
    }

    fn return_parsed(&mut self, fx: &mut Fx, created: V, end: V) {
        self.emit_parser_operation(fx, Operation::JSONSetCursor, &[end], self.known.undefined);
        self.terminate_with_return(fx, created);
    }

    fn emit_array_parser(
        &mut self,
        fx: &mut Fx,
        plan: &Rc<ValidationPlan>,
        number: u32,
        node: u32,
        ty: TypeId,
        element: u32,
        start: V,
        fails: BlockId,
    ) {
        let want = Ty {
            id: self.ty_of(ty),
            checked: ty,
        };
        let list = self.emit_throwing(fx, Op::NewArray(Args::new()));
        let list = self.coerce_to(fx, list, want, CoerceReason::Cast);
        let cursor = fx.b.new_var(self.known.counter);
        let (is_empty, turn, done) = (fx.b.new_block(), fx.b.new_block(), fx.b.new_block());
        let first = self.skip_whitespace(fx, start);
        fx.b.write(cursor, first);
        self.branch_on_text(fx, first, b"]", false, is_empty, turn);
        fx.b.seal(is_empty);
        fx.b.switch_to(is_empty);
        let after = self.advance(fx, first, 1);
        fx.b.write(cursor, after);
        fx.b.jump(done);
        fx.b.switch_to(turn);
        self.emit(fx, Op::Poll);
        let at = fx.b.read(cursor);
        let (item, after) = self.emit_parsed(fx, plan, number, element, at, Found::Expected, fails);
        let push = self.out.strs.intern(b"push");
        self.emit_throwing(
            fx,
            Op::CallMethod {
                obj: list,
                name: push,
                args: [item].into_iter().collect(),
            },
        );
        fx.b.write(cursor, after);
        self.branch_on_separator(fx, cursor, b"]", turn, done, fails);
        fx.b.seal(turn);
        fx.b.seal(done);
        fx.b.switch_to(done);
        self.emit_rules(fx, &plan.nodes[node as usize].rules, list, fails);
        let end = fx.b.read(cursor);
        self.return_parsed(fx, list, end);
    }

    fn emit_key_and_value(
        &mut self,
        fx: &mut Fx,
        plan: &Rc<ValidationPlan>,
        number: u32,
        held: u32,
        at: V,
        fails: BlockId,
    ) -> (V, V, V) {
        let key_start = self.continue_after_text(fx, at, b"\"", true, fails);
        let key =
            self.emit_parser_operation(fx, Operation::JSONKeyAt, &[key_start], self.known.string);
        let after_key = self.continue_after_parsed_value(fx, fails);
        let within = self.continue_after_text_and_whitespace(fx, after_key, b":", fails);
        let (value, after) =
            self.emit_parsed(fx, plan, number, held, within, Found::Expected, fails);
        (key, value, after)
    }

    fn emit_dictionary_parser(
        &mut self,
        fx: &mut Fx,
        plan: &Rc<ValidationPlan>,
        number: u32,
        held: u32,
        start: V,
        fails: BlockId,
    ) {
        let created = self.emit(fx, Op::NewObject);
        let cursor = fx.b.new_var(self.known.counter);
        let (is_empty, turn, done) = (fx.b.new_block(), fx.b.new_block(), fx.b.new_block());
        let first = self.skip_whitespace(fx, start);
        fx.b.write(cursor, first);
        self.branch_on_text(fx, first, b"}", false, is_empty, turn);
        fx.b.seal(is_empty);
        fx.b.switch_to(is_empty);
        let after = self.advance(fx, first, 1);
        fx.b.write(cursor, after);
        fx.b.jump(done);
        fx.b.switch_to(turn);
        self.emit(fx, Op::Poll);
        let at = fx.b.read(cursor);
        let gives_up = self.give_up(fx, fails);
        let (key, value, after) = self.emit_key_and_value(fx, plan, number, held, at, gives_up);
        fx.b.seal(gives_up);
        self.operation(fx, Operation::PutByValDirect, &[created, key, value]);
        fx.b.write(cursor, after);
        self.branch_on_separator(fx, cursor, b"}", turn, done, fails);
        fx.b.seal(turn);
        fx.b.seal(done);
        fx.b.switch_to(done);
        let end = fx.b.read(cursor);
        self.return_parsed(fx, created, end);
    }

    fn emit_tuple_parser(
        &mut self,
        fx: &mut Fx,
        plan: &Rc<ValidationPlan>,
        number: u32,
        ty: TypeId,
        elements: &[u32],
        start: V,
        fails: BlockId,
    ) {
        let mut cursor = self.skip_whitespace(fx, start);
        let mut items = Vec::with_capacity(elements.len());
        for (at, &element) in elements.iter().enumerate() {
            if at > 0 {
                cursor = self.continue_after_text_and_whitespace(fx, cursor, b",", fails);
            }
            let (item, after) =
                self.emit_parsed(fx, plan, number, element, cursor, Found::Expected, fails);
            items.push(item);
            cursor = after;
        }
        let cursor = self.skip_whitespace(fx, cursor);
        let end = self.continue_after_text(fx, cursor, b"]", true, fails);
        let created = self.emit_list(fx, &items);
        let want = Ty {
            id: self.ty_of(ty),
            checked: ty,
        };
        let created = self.coerce_to(fx, created, want, CoerceReason::Cast);
        self.return_parsed(fx, created, end);
    }

    fn declare_object_variables(
        &mut self,
        fx: &mut Fx,
        plan: &ValidationPlan,
        members: &[PlannedMember],
        start: V,
    ) -> ObjectParse {
        let cursor = fx.b.new_var(self.known.counter);
        fx.b.write(cursor, start);
        let (mut held, mut bits, mut count) = (
            Vec::with_capacity(members.len()),
            Vec::with_capacity(members.len()),
            0,
        );
        for member in members {
            let is_always_present = is_always_present(plan, member);
            let (ty, blank) = match plan.nodes[member.node as usize].planned {
                Planned::Primitive(PlannedPrimitive::Text) if is_always_present => {
                    (self.known.string, self.emit_text(fx, b""))
                }
                Planned::Primitive(PlannedPrimitive::Number)
                    if is_always_present
                        && plan.nodes[member.node as usize]
                            .rules
                            .contains(&Rule::Integer) =>
                {
                    (self.exact_integer(), self.emit(fx, Op::Int(0)))
                }
                Planned::Primitive(PlannedPrimitive::Number) if is_always_present => {
                    (self.known.number, self.emit(fx, Op::Double(0f64.to_bits())))
                }
                Planned::Primitive(PlannedPrimitive::Boolean) if is_always_present => {
                    (self.known.boolean, self.emit(fx, Op::Bool(false)))
                }
                _ => (self.out.tys.anything, self.emit(fx, Op::Undefined)),
            };
            let variable = fx.b.new_var(ty);
            fx.b.write(variable, blank);
            held.push(variable);
            bits.push(
                is_always_present
                    .then(|| (count / MEMBERS_PER_MASK, 1i64 << (count % MEMBERS_PER_MASK))),
            );
            count += usize::from(is_always_present);
        }
        let seen = (0..count.div_ceil(MEMBERS_PER_MASK))
            .map(|_| self.new_selector(fx))
            .collect();
        let (kept_keys, kept_values) = (self.new_temporary(fx), self.new_temporary(fx));
        let undefined = self.emit(fx, Op::Undefined);
        fx.b.write(kept_keys, undefined);
        fx.b.write(kept_values, undefined);
        let (failed_at, failed_name, refusal) = (
            fx.b.new_var(self.known.counter),
            fx.b.new_var(self.known.string),
            fx.b.new_block(),
        );
        ObjectParse {
            cursor,
            held,
            seen,
            bits,
            kept_keys,
            kept_values,
            failed_at,
            failed_name,
            refusal,
        }
    }

    fn resolve_absent_members(
        &mut self,
        fx: &mut Fx,
        plan: &Rc<ValidationPlan>,
        number: u32,
        members: &[PlannedMember],
        parsed: &ObjectParse,
        fails: BlockId,
    ) -> Vec<V> {
        let mut values = Vec::with_capacity(members.len());
        for (member, &variable) in members.iter().zip(&parsed.held) {
            let value = fx.b.read(variable);
            if is_always_present(plan, member)
                || (member.is_optional && !may_have_default(plan, member.node, 0))
            {
                values.push(value);
                continue;
            }
            let settled = self.new_temporary(fx);
            fx.b.write(settled, value);
            let undefined = self.emit(fx, Op::Undefined);
            let is_absent = self.emit(
                fx,
                Op::StrictEq {
                    a: value,
                    b: undefined,
                },
            );
            let (absent, next) = (fx.b.new_block(), fx.b.new_block());
            self.branch(fx, is_absent, absent, next);
            fx.b.seal(absent);
            fx.b.switch_to(absent);
            let invalid = if member.is_omitted_when_invalid {
                next
            } else {
                fails
            };
            let filled = self.emit_validation(fx, plan, number, member.node, undefined, invalid);
            fx.b.write(settled, filled);
            fx.b.jump(next);
            fx.b.seal(next);
            fx.b.switch_to(next);
            values.push(fx.b.read(settled));
        }
        values
    }

    fn exit_to_general_path(
        &mut self,
        fx: &mut Fx,
        parsed: &ObjectParse,
        cursor: V,
        seen: &[i64],
        to: BlockId,
    ) -> BlockId {
        let (here, leaves) = (fx.b.block, fx.b.new_block());
        fx.b.switch_to(leaves);
        fx.b.write(parsed.cursor, cursor);
        for (&variable, &mask) in parsed.seen.iter().zip(seen) {
            let mask = self.emit(fx, Op::Int(mask));
            fx.b.write(variable, mask);
        }
        fx.b.jump(to);
        fx.b.switch_to(here);
        leaves
    }

    fn reject_member(
        &mut self,
        fx: &mut Fx,
        parsed: &ObjectParse,
        value_start: V,
        name: &[u8],
    ) -> BlockId {
        let (here, refuses) = (fx.b.block, fx.b.new_block());
        fx.b.switch_to(refuses);
        let name = self.emit_text(fx, name);
        fx.b.write(parsed.failed_at, value_start);
        fx.b.write(parsed.failed_name, name);
        fx.b.jump(parsed.refusal);
        fx.b.switch_to(here);
        refuses
    }

    fn give_up(&mut self, fx: &mut Fx, fails: BlockId) -> BlockId {
        let (here, gives_up) = (fx.b.block, fx.b.new_block());
        fx.b.switch_to(gives_up);
        self.emit_parser_operation(fx, Operation::JSONGiveUp, &[], self.known.undefined);
        fx.b.jump(fails);
        fx.b.switch_to(here);
        gives_up
    }

    fn emit_object_parser(
        &mut self,
        fx: &mut Fx,
        plan: &Rc<ValidationPlan>,
        number: u32,
        node: u32,
        start: V,
        fails: BlockId,
    ) {
        let Planned::Object {
            members, others, ..
        } = &plan.nodes[node as usize].planned
        else {
            return;
        };
        let parsed = self.declare_object_variables(fx, plan, members, start);
        let (after_brace, after_value, key, finish) = (
            fx.b.new_block(),
            fx.b.new_block(),
            fx.b.new_block(),
            fx.b.new_block(),
        );

        let mut cursor = start;
        let mut seen = vec![0i64; parsed.seen.len()];
        let mut has_exited_early = false;
        for (at, member) in members.iter().enumerate() {
            if at == 0 && member.is_optional {
                let leaves = self.exit_to_general_path(fx, &parsed, cursor, &seen, after_brace);
                fx.b.jump(leaves);
                fx.b.seal(leaves);
                has_exited_early = true;
                break;
            }
            let opener = opening_byte(plan, member.node);
            let leaves = if member.is_optional && opener.is_some() {
                fails
            } else {
                self.exit_to_general_path(
                    fx,
                    &parsed,
                    cursor,
                    &seen,
                    if at == 0 { after_brace } else { after_value },
                )
            };
            let mut prefix = Vec::with_capacity(member.name.len() + 5);
            if at > 0 {
                prefix.push(b',');
            }
            prefix.push(b'"');
            prefix.extend_from_slice(&member.name);
            prefix.extend_from_slice(b"\":");
            prefix.extend(opener);
            let (absent, next) = (fx.b.new_block(), fx.b.new_block());
            let within = self.continue_after_text(
                fx,
                cursor,
                &prefix,
                !member.is_optional,
                if member.is_optional { absent } else { leaves },
            );
            let value_start = if opener.is_some() {
                self.advance(fx, cursor, prefix.len() - 1)
            } else {
                within
            };
            let invalid = if member.is_omitted_when_invalid {
                fx.b.new_block()
            } else {
                self.reject_member(fx, &parsed, value_start, &member.name)
            };
            let unsure = if opener.is_some() {
                invalid
            } else {
                fx.b.new_block()
            };
            let (value, after) =
                self.emit_parsed(fx, plan, number, member.node, within, Found::Opened, unsure);
            fx.b.write(parsed.held[at], value);
            fx.b.write(parsed.cursor, after);
            fx.b.jump(next);
            if opener.is_none() {
                fx.b.seal(unsure);
                fx.b.switch_to(unsure);
                let byte = self.emit_parser_operation(
                    fx,
                    Operation::JSONByteAt,
                    &[within],
                    self.known.int32,
                );
                let space = self.emit(fx, Op::Int(0x20));
                let is_whitespace = self.emit(
                    fx,
                    Op::Relational {
                        op: RelOp::Le,
                        a: byte,
                        b: space,
                    },
                );
                fx.b.branch(is_whitespace, leaves, invalid);
            }
            if leaves != fails {
                fx.b.seal(leaves);
            }
            fx.b.seal(invalid);
            if member.is_omitted_when_invalid {
                fx.b.switch_to(invalid);
                let after = self.emit_parser_operation(
                    fx,
                    Operation::JSONSkipValue,
                    &[value_start],
                    self.known.counter,
                );
                self.continue_if_parsed(fx, after, fails);
                fx.b.write(parsed.cursor, after);
                fx.b.jump(next);
            }
            fx.b.seal(absent);
            fx.b.switch_to(absent);
            fx.b.write(parsed.cursor, cursor);
            fx.b.jump(next);
            fx.b.seal(next);
            fx.b.switch_to(next);
            cursor = fx.b.read(parsed.cursor);
            if let Some((mask, bit)) = parsed.bits[at] {
                seen[mask] |= bit;
            }
        }
        if !has_exited_early {
            let leaves = self.exit_to_general_path(
                fx,
                &parsed,
                cursor,
                &seen,
                if members.is_empty() {
                    after_brace
                } else {
                    after_value
                },
            );
            let end = self.continue_after_text(fx, cursor, b"}", true, leaves);
            fx.b.seal(leaves);
            let values = self.resolve_absent_members(fx, plan, number, members, &parsed, fails);
            let created =
                self.emit_object_from_checked_members(fx, plan, number, node, None, &values, fails);
            self.return_parsed(fx, created, end);
        }

        fx.b.seal(after_brace);
        fx.b.switch_to(after_brace);
        let at = fx.b.read(parsed.cursor);
        let at = self.skip_whitespace(fx, at);
        fx.b.write(parsed.cursor, at);
        let is_empty = fx.b.new_block();
        self.branch_on_text(fx, at, b"}", false, is_empty, key);
        fx.b.seal(is_empty);
        fx.b.switch_to(is_empty);
        let after = self.advance(fx, at, 1);
        fx.b.write(parsed.cursor, after);
        fx.b.jump(finish);

        fx.b.seal(after_value);
        fx.b.switch_to(after_value);
        self.branch_on_separator(fx, parsed.cursor, b"}", key, finish, fails);

        fx.b.switch_to(key);
        self.emit(fx, Op::Poll);
        let at = fx.b.read(parsed.cursor);
        let arms: Vec<BlockId> = members.iter().map(|_| fx.b.new_block()).collect();
        let (unknown, after_member) = (fx.b.new_block(), fx.b.new_block());
        let all: Vec<usize> = (0..members.len()).collect();
        self.emit_key_dispatch(fx, members, at, &all, &arms, unknown);
        for (index, member) in members.iter().enumerate() {
            fx.b.seal(arms[index]);
            fx.b.switch_to(arms[index]);
            let after_key = self.advance(fx, at, member.name.len() + 2);
            let within = self.continue_after_text_and_whitespace(fx, after_key, b":", fails);
            let invalid = if member.is_omitted_when_invalid {
                fx.b.new_block()
            } else {
                self.reject_member(fx, &parsed, within, &member.name)
            };
            let (value, after) = self.emit_parsed(
                fx,
                plan,
                number,
                member.node,
                within,
                Found::Expected,
                invalid,
            );
            fx.b.write(parsed.held[index], value);
            fx.b.write(parsed.cursor, after);
            if let Some((mask, bit)) = parsed.bits[index] {
                let so_far = fx.b.read(parsed.seen[mask]);
                let bit = self.emit(fx, Op::Int(bit));
                let more = self.emit(
                    fx,
                    Op::Binary {
                        op: BinOp::BitOr,
                        a: so_far,
                        b: bit,
                    },
                );
                fx.b.func.values[more.idx()].ty = self.known.int32;
                fx.b.write(parsed.seen[mask], more);
            }
            fx.b.jump(after_member);
            fx.b.seal(invalid);
            if member.is_omitted_when_invalid {
                fx.b.switch_to(invalid);
                let after = self.emit_parser_operation(
                    fx,
                    Operation::JSONSkipValue,
                    &[within],
                    self.known.counter,
                );
                self.continue_if_parsed(fx, after, fails);
                let undefined = self.emit(fx, Op::Undefined);
                fx.b.write(parsed.held[index], undefined);
                fx.b.write(parsed.cursor, after);
                fx.b.jump(after_member);
            }
        }
        fx.b.seal(unknown);
        fx.b.switch_to(unknown);
        match *others {
            OtherKeys::Omitted => {
                let after = self.emit_parser_operation(
                    fx,
                    Operation::JSONSkipMember,
                    &[at],
                    self.known.counter,
                );
                self.continue_if_parsed(fx, after, fails);
                fx.b.write(parsed.cursor, after);
                fx.b.jump(after_member);
            }
            OtherKeys::Refused => {
                self.emit_parser_operation(
                    fx,
                    Operation::JSONSkipMember,
                    &[at],
                    self.known.counter,
                );
                fx.b.jump(fails);
            }
            OtherKeys::Kept(held) => {
                let gives_up = self.give_up(fx, fails);
                let (key, value, after) =
                    self.emit_key_and_value(fx, plan, number, held, at, gives_up);
                fx.b.seal(gives_up);
                fx.b.write(parsed.cursor, after);
                let keys = fx.b.read(parsed.kept_keys);
                let undefined = self.emit(fx, Op::Undefined);
                let is_first = self.emit(
                    fx,
                    Op::StrictEq {
                        a: keys,
                        b: undefined,
                    },
                );
                let (first, next) = (fx.b.new_block(), fx.b.new_block());
                self.branch(fx, is_first, first, next);
                fx.b.seal(first);
                fx.b.switch_to(first);
                let keys = self.emit_list(fx, &[]);
                let values = self.emit_list(fx, &[]);
                fx.b.write(parsed.kept_keys, keys);
                fx.b.write(parsed.kept_values, values);
                fx.b.jump(next);
                fx.b.seal(next);
                fx.b.switch_to(next);
                let push = self.out.strs.intern(b"push");
                for (list, item) in [(parsed.kept_keys, key), (parsed.kept_values, value)] {
                    let list = fx.b.read(list);
                    let list = self.claim_type(fx, list, self.known.array);
                    self.emit_throwing(
                        fx,
                        Op::CallMethod {
                            obj: list,
                            name: push,
                            args: [item].into_iter().collect(),
                        },
                    );
                }
                fx.b.jump(after_member);
            }
        }
        fx.b.seal(after_member);
        fx.b.switch_to(after_member);
        self.branch_on_separator(fx, parsed.cursor, b"}", key, finish, fails);
        fx.b.seal(key);

        fx.b.seal(parsed.refusal);
        fx.b.switch_to(parsed.refusal);
        let (failed_at, failed_name) = (fx.b.read(parsed.failed_at), fx.b.read(parsed.failed_name));
        self.emit_parser_operation(
            fx,
            Operation::JSONGiveUpIfRepeated,
            &[failed_at, failed_name],
            self.known.undefined,
        );
        fx.b.jump(fails);

        fx.b.seal(finish);
        fx.b.switch_to(finish);
        for (mask, &variable) in parsed.seen.iter().enumerate() {
            let wanted: i64 = parsed
                .bits
                .iter()
                .flatten()
                .filter(|&&(of, _)| of == mask)
                .map(|&(_, bit)| bit)
                .sum();
            let so_far = fx.b.read(variable);
            let wanted = self.emit(fx, Op::Int(wanted));
            let is_complete = self.emit(
                fx,
                Op::StrictEq {
                    a: so_far,
                    b: wanted,
                },
            );
            let is_complete = self.emit_parser_operation(
                fx,
                Operation::Likely,
                &[is_complete],
                self.known.boolean,
            );
            let next = fx.b.new_block();
            fx.b.branch(is_complete, next, fails);
            fx.b.seal(next);
            fx.b.switch_to(next);
        }
        let values = self.resolve_absent_members(fx, plan, number, members, &parsed, fails);
        let created =
            self.emit_object_from_checked_members(fx, plan, number, node, None, &values, fails);
        if matches!(others, OtherKeys::Kept(_)) {
            let keys = fx.b.read(parsed.kept_keys);
            let values = fx.b.read(parsed.kept_values);
            let undefined = self.emit(fx, Op::Undefined);
            let has_none = self.emit(
                fx,
                Op::StrictEq {
                    a: keys,
                    b: undefined,
                },
            );
            let (some, next) = (fx.b.new_block(), fx.b.new_block());
            self.branch(fx, has_none, next, some);
            fx.b.seal(some);
            fx.b.switch_to(some);
            let values = self.claim_type(fx, values, self.known.array);
            self.emit_loop(fx, keys, |build, fx, at, key| {
                let key = build.claim_type(fx, key, build.known.string);
                let value = build.emit_throwing(
                    fx,
                    Op::ElemGet {
                        obj: values,
                        key: at,
                    },
                );
                build.operation(fx, Operation::PutByValDirect, &[created, key, value]);
            });
            fx.b.jump(next);
            fx.b.seal(next);
            fx.b.switch_to(next);
        }
        let end = fx.b.read(parsed.cursor);
        self.return_parsed(fx, created, end);
    }

    fn emit_key_dispatch(
        &mut self,
        fx: &mut Fx,
        members: &[PlannedMember],
        cursor: V,
        candidates: &[usize],
        arms: &[BlockId],
        unknown: BlockId,
    ) {
        let byte_at =
            |index: usize, place: usize| members[index].name.get(place).copied().unwrap_or(b'"');
        let shortest = candidates
            .iter()
            .map(|&index| members[index].name.len())
            .min()
            .unwrap_or(0);
        let distinct_at = |place: usize| {
            let mut bytes: Vec<u8> = candidates
                .iter()
                .map(|&index| byte_at(index, place))
                .collect();
            bytes.sort_unstable();
            bytes.dedup();
            bytes.len()
        };
        let best = (0..=shortest.min(MAX_KEY_BYTE_INSPECTED))
            .max_by_key(|&place| (distinct_at(place), std::cmp::Reverse(place)))
            .unwrap_or(0);
        if candidates.len() <= MAX_KEYS_COMPARED_SEQUENTIALLY || distinct_at(best) < 2 {
            for &index in candidates {
                let next = fx.b.new_block();
                let quoted = [b"\"", &members[index].name[..], b"\""].concat();
                self.branch_on_text(fx, cursor, &quoted, false, arms[index], next);
                fx.b.seal(next);
                fx.b.switch_to(next);
            }
            fx.b.jump(unknown);
            return;
        }
        let place = self.advance(fx, cursor, best + 1);
        let byte =
            self.emit_parser_operation(fx, Operation::JSONByteAt, &[place], self.known.int32);
        let mut groups: Vec<(u8, Vec<usize>)> = Vec::new();
        for &index in candidates {
            let byte = byte_at(index, best);
            match groups.iter_mut().find(|group| group.0 == byte) {
                Some(group) => group.1.push(index),
                None => groups.push((byte, vec![index])),
            }
        }
        let blocks: Vec<BlockId> = groups.iter().map(|_| fx.b.new_block()).collect();
        let cases = groups
            .iter()
            .zip(&blocks)
            .map(|(group, &block)| (i64::from(group.0), Target::new(block)))
            .collect();
        fx.b.terminate(Term::Switch {
            value: byte,
            cases,
            default: Target::new(unknown),
        });
        for (group, &block) in groups.iter().zip(&blocks) {
            fx.b.seal(block);
            fx.b.switch_to(block);
            self.emit_key_dispatch(fx, members, cursor, &group.1, arms, unknown);
        }
    }
}
