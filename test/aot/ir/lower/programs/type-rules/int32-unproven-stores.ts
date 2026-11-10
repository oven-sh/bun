// RUN: lower
// OPTIONS: builtin-modules
// DIAGNOSTIC: UnprovenInt32 40

// A value stored into an `int32` that is not one by proof stops the build, and the message says what was found and what to write. type-rules/int32-checked-at-run-time has the flows that the build does not see.
import type { int32 } from "bun";

const given: number[] = JSON.parse("[3, 1.5]");
const loose: any = JSON.parse("4");
const list = [1, 2];
const text = "text";

class Cursor {
  line: int32 = 0;
  column: int32 = given[0];
  constructor(public start: int32 = given[1]) {}
  move(by: int32): int32 {
    this.line += by;
    return this.line + by;
  }
}
interface Point {
  x: int32;
  y?: int32;
}

function add(a: int32, b: int32): int32 { return a + b; }
function subtract(a: int32, b: int32): int32 { return a - b; }
function times(a: int32, b: int32): int32 { return a * b; }
function half(a: int32): int32 { return a / 2; }
function negative(a: int32): int32 { return -a; }
function rest(a: int32, b: int32): int32 { return a % b; }
function power(a: int32): int32 { return a ** 2; }
function unsigned(a: int32): int32 { return a >>> 0; }
function code(i: int32): int32 { return text.charCodeAt(i); }
function size(): int32 { return list.length; }
function floor(n: number): int32 { return Math.floor(n); }
function plain(n: number): int32 { return n; }
function inclusive(to: int32): int32 { let last: int32 = 0; for (let i: int32 = 0; i <= to; i++) last = i; return last; }
function byTwo(to: int32): int32 { let last: int32 = 0; for (let i: int32 = 0; i < to; i += 2) last = i; return last; }
function counted(to: int32): int32 { let turns: int32 = 0; for (let i: int32 = 0; i < to; i++) turns++; return turns; }
function testedAfter(to: int32): int32 { let i: int32 = 0; do i++; while (i < to); return i; }
function reassigned(to: int32, jump: int32): int32 { let last: int32 = 0; for (let i: int32 = 0; i < to; i++) { if (i === 2) i = jump; last = i; } return last; }

let kept: int32 = given[0];
kept = loose;
kept = given[1] + 1;
kept += 1;
kept -= given[0];
kept *= 3;
kept /= 2;
kept >>>= 0;
kept--;
[kept] = given;
({ kept } = { kept: 1 });
for (kept of given) {}
const cursor = new Cursor(given[0]);
cursor.line = given[0];
cursor["column"] = given[1];
cursor.line++;
cursor.move(given[1]);
add(1, given[0]);
add(...(given as [number, number]));
const point: Point = { x: given[0], y: loose };
console.log(kept, cursor, point, subtract(1, 2), times(1, 2), half(1), negative(1), rest(1, 2), power(1), unsigned(1), code(1), size(), floor(1), plain(1), inclusive(1), byTwo(1), counted(1), testedAfter(1), reassigned(1, 2));

// GENERATED: subtract half negative power unsigned floor Cursor
// CHECK-LABEL: function {{*}}name="subtract"
// CHECK: module=[[m_0]] position={{*}} sourceRange={{*}} flags=[IsChecked, HasExplicitName] length=2 thisType={type=anything} parameters=[{type=i32 flags=[IsInt32Promise]}, {type=i32 flags=[IsInt32Promise]}] results=[{type=i32 flags=[IsInt32Promise]}] {
// CHECK-NEXT: b0(v0: i32, v1: i32):
// CHECK-NEXT: v2 = Sub v0, v1
// CHECK-NEXT: v3 = Convert v2 declared={type=i32 flags=[IsInt32Promise]}
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="half"
// CHECK: module=[[m_0]] position={{*}} sourceRange={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=i32 flags=[IsInt32Promise]}] results=[{type=i32 flags=[IsInt32Promise]}] {
// CHECK-NEXT: b0(v0: i32):
// CHECK-NEXT: v1 = Integer integer=2
// CHECK-NEXT: v2 = Div v0, v1
// CHECK-NEXT: v3 = Convert v2 declared={type=i32 flags=[IsInt32Promise]}
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="negative"
// CHECK: module=[[m_0]] position={{*}} sourceRange={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=i32 flags=[IsInt32Promise]}] results=[{type=i32 flags=[IsInt32Promise]}] {
// CHECK-NEXT: b0(v0: i32):
// CHECK-NEXT: v1 = Negate v0
// CHECK-NEXT: v2 = Convert v1 declared={type=i32 flags=[IsInt32Promise]}
// CHECK-NEXT: Return v2
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="power"
// CHECK: module=[[m_0]] position={{*}} sourceRange={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=i32 flags=[IsInt32Promise]}] results=[{type=i32 flags=[IsInt32Promise]}] {
// CHECK-NEXT: b0(v0: i32):
// CHECK-NEXT: v1 = Integer integer=2
// CHECK-NEXT: v2 = Pow v0, v1
// CHECK-NEXT: v3 = Convert v2 declared={type=i32 flags=[IsInt32Promise]}
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="unsigned"
// CHECK: module=[[m_0]] position={{*}} sourceRange={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=i32 flags=[IsInt32Promise]}] results=[{type=i32 flags=[IsInt32Promise]}] {
// CHECK-NEXT: b0(v0: i32):
// CHECK-NEXT: v1 = Integer
// CHECK-NEXT: v2 = URShift v0, v1
// CHECK-NEXT: v3 = Convert v2 declared={type=i32 flags=[IsInt32Promise]}
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="floor"
// CHECK: module=[[m_0]] position={{*}} sourceRange={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=number}] results=[{type=i32 flags=[IsInt32Promise]}] {
// CHECK-NEXT: b0(v0: number):
// CHECK-NEXT: v1 = Builtin builtin=Math
// CHECK-NEXT: v2 = Builtin builtin=MathFloor
// CHECK-NEXT: v3 = Call v2, v1, v0 calleeName="Math.floor"
// CHECK-NEXT: ReturnCall v3 casts=[{declared={type=number}}, {declared={type=i32 flags=[IsInt32Promise]}}]
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Cursor"
// CHECK: module=[[m_0]] position={{*}} sourceRange={{*}} kind=BaseConstructor flags=[HasNewTarget, IsChecked, HasExplicitName] thisType={type=anything} parameters=[{type=undefined|i32 flags=[IsInt32Promise]}] results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: anything, v1: undefined|i32):
// CHECK-NEXT: v2 = GetConstructPrototype v0 layout=[[L_1]]
// CHECK-NEXT: v3 = NewObject v2 layout=[[L_1]]
// CHECK-NEXT: v4 = Convert v3 declared={type=[[L_1]]}
// CHECK-NEXT: v5 = CallDirect v4 function=[[f_2]]
// CHECK-NEXT: v6 = TypeTest v1 testedType=undefined
// CHECK-NEXT: Branch v6 -> taken b1(| 0), notTaken b2(| 0)
// CHECK-NEXT: b1(v7):
// CHECK-NEXT: v8 = GetModuleVariable variable=[[g_3]]
// CHECK-NEXT: v9 = CheckInitialized v8 name="given"
// CHECK-NEXT: v10 = Integer integer=1
// CHECK-NEXT: v11 = ElemGet v9, v10
// CHECK-NEXT: v12 = Convert v11 declared={type=i32 flags=[IsInt32Promise]}
// CHECK-NEXT: Jump -> next b3(v12)
// CHECK-NEXT: b2(v13):
// CHECK-NEXT: Jump -> next b3(v13)
// CHECK-NEXT: b3(v14):
// CHECK-NEXT: PropSet v4, v14 key="start"
// CHECK-NEXT: v16 = Undefined
// CHECK-NEXT: v17 = TypeTest v16 testedType=object
// CHECK-NEXT: Branch v17 -> taken b4(| 0), notTaken b5(v4)
// CHECK-NEXT: b4(v18):
// CHECK-NEXT: Jump -> next b5(v18)
// CHECK-NEXT: b5(v19):
// CHECK-NEXT: Return v19
// CHECK-NEXT: }
