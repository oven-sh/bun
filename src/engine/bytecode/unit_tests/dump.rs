use bun_engine_text::Text;

use super::support::*;
use crate::assembler::Assembler;
use crate::*;

#[test]
fn instructions_and_tables() {
    let mut a = Assembler::default();
    let (handler, one, end) = (a.label(), a.label(), a.label());
    a.enter(1);
    a.resume_dispatch();
    a.cover(CoverageBlockIndex(0));
    a.add_coverage_block(CoverageBlock {
        start: -1,
        end: 0,
        kind: CoverageKind::LoopHeader,
    });
    a.push_try(handler, HandlerKind::SynthesizedCatch);
    a.position(4, 2, 7);
    a.get_by_id(local(200), Register::THIS, IdentifierIndex(1));
    a.put_by_id(
        local(2),
        IdentifierIndex(70_000),
        Register::CALLEE,
        PutFlags::all(),
    );
    let point = a.add_suspend_point(SuspendKind::Await);
    a.r#await(local(1), Operand::constant(STRING), point);
    a.resume(local(1), point);
    let switch = a.add_int_switch(end, &[(1, one), (3, one)]);
    a.switch_int(local(2), switch);
    a.bind(one);
    a.position(40, 30, 50);
    a.new_class(
        local(3),
        local(4),
        local(0),
        FunctionIndex(CLASS),
        Operand::constant(3),
        Operand::constant(4),
    );
    let mask = a.add_spread_mask([false, true].into_iter());
    a.new_array_with_spread(local(3), local(4), 2, mask);
    a.iterator_begin(local(5), local(3));
    let switch = a.add_string_switch(end, &[one]);
    a.switch_string(local(2), switch);
    a.pop_try();
    a.bind(handler);
    a.catch(local(2), local(3));
    a.create_scope(local(3), local(0), ScopeIndex(BLOCK_SCOPE));
    a.copy_rest(local(3), local(3), NameListIndex(2), local(4), 0);
    a.jump_if_true(local(3), one);
    a.bind(end);
    a.throw_static(StaticError::AssignToCall, IdentifierIndex(0));
    let flags = CodeFlags::STRICT | CodeFlags::SUSPENDS;
    let code = code(a.finish(CodeKind::Call, flags, 202, 1).unwrap(), 5);
    let dump = Dump::new(&code, Text::from_ascii("x(a.\nb\")"));
    assert_eq!(dump.with_positions().to_string(), EXPECTED);
}

const EXPECTED: &str = r#"Call STRICT SUSPENDS: 90 bytes, 202 locals, 1 parameters, 10 words of metadata
[    0] enter                        variables: 1
[    2] resume_dispatch
[    3] cover                        block: 0  Coverage@9
        // 4 in 2..7 "a.\nb\""
[    7] *get_by_id                   dst: loc200, base: this, name: id1("b")  GetById@0
[   17] **put_by_id                  base: loc2, name: id70000(?), value: callee, flags: 3 STRICT DIRECT  PutById@4
[   39] await                        generator: loc1, value: k2("text"), point: 0
[   43] resume                       generator: loc1, point: 0
[   46] switch_int                   value: loc2, table: 0
        // 40 in 30..50 ?
[   49] new_class                    constructor: loc3, prototype: loc4, scope: loc0, function: f1("C"), heritage: k3(empty), name: k4(undefined)
[   56] new_array_with_spread        dst: loc3, first: loc4.., count: 2, mask: 0
[   61] iterator_begin               state: loc5-loc7, iterable: loc3  IterationModes@7
[   66] switch_string                value: loc2, table: 0
[   69] catch                        exception: loc2, value: loc3  Catch@8
[   74] create_scope                 dst: loc3, parent: loc0, scope: scope0(Block)
[   78] copy_rest                    dst: loc3, source: loc3, excluded: names2(["a", "b"]), first: loc4.., count: 0
[   84] jump_if_true                 value: loc3, target: ->49
[   87] throw_static                 error: AssignToCall, name: id0("a")
handlers
  0: 7..69 ->69 SynthesizedCatch
int switches
  0: 1 ->49, 3 ->49, default ->87
string switches
  0: "key0" ->49, default ->87
spread masks
  0: [1]
suspend points
  0: Await at 39 ->43 saves [loc2, loc5]
coverage
  0: LoopHeader -1..0
constants
  0: [null, 0.5]
  1: /x+/g
  2: "text"
  3: empty
  4: undefined
identifiers
  0: "a"
  1: "b"
  2: "c"
  3: "a"
  4: "b"
scopes
  0: Block, 3 slots, 3 undefined, 0 mapped
     0: a Variable
     1: b Variable
     2: c Variable
  1: With, 0 slots, 0 undefined, 0 mapped
functions
  0: "f" Normal STRICT, Public, length 1, source 0..9, created at 0
  1: "C" BaseConstructor STRICT, Public, length 1, source 0..9, created at 0
"#;
