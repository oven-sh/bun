// RUN: lower
// OPTIONS: builtin-modules

// Twelve record types of one family. Thirteen properties, each in some of them: the first few, the last few, some in the middle, every other one.
// Every property is read from every object behind a written cast, compared with undefined, and stored to through the cast where the object has it.

interface Part { kind: number; }
interface Part0 extends Part { own0: string; head1: number; head3: number; head7: number; head11: number; ends: number; holes: number; }
interface Part1 extends Part { own1: string; head3: number; head7: number; head11: number; odd: number; holes: number; }
interface Part2 extends Part { own2: string; head3: number; head7: number; head11: number; three: number; }
interface Part3 extends Part { own3: string; head7: number; head11: number; tail9: number; middle6: number; odd: number; }
interface Part4 extends Part { own4: string; head7: number; head11: number; tail9: number; middle6: number; holes: number; }
interface Part5 extends Part { own5: string; head7: number; head11: number; tail9: number; middle2: number; middle6: number; odd: number; holes: number; }
interface Part6 extends Part { own6: string; head7: number; head11: number; tail9: number; middle2: number; middle6: number; three: number; }
interface Part7 extends Part { own7: string; head11: number; tail9: number; middle6: number; odd: number; }
interface Part8 extends Part { own8: string; head11: number; tail4: number; tail9: number; middle6: number; holes: number; }
interface Part9 extends Part { own9: string; head11: number; tail4: number; tail9: number; odd: number; holes: number; }
interface Part10 extends Part { own10: string; head11: number; tail4: number; tail9: number; three: number; }
interface Part11 extends Part { own11: string; tail1: number; tail4: number; tail9: number; odd: number; ends: number; }
type With_head1 = Part0;
type With_head3 = Part0 | Part1 | Part2;
type With_head7 = Part0 | Part1 | Part2 | Part3 | Part4 | Part5 | Part6;
type With_head11 = Part0 | Part1 | Part2 | Part3 | Part4 | Part5 | Part6 | Part7 | Part8 | Part9 | Part10;
type With_tail1 = Part11;
type With_tail4 = Part8 | Part9 | Part10 | Part11;
type With_tail9 = Part3 | Part4 | Part5 | Part6 | Part7 | Part8 | Part9 | Part10 | Part11;
type With_middle2 = Part5 | Part6;
type With_middle6 = Part3 | Part4 | Part5 | Part6 | Part7 | Part8;
type With_odd = Part1 | Part3 | Part5 | Part7 | Part9 | Part11;
type With_ends = Part0 | Part11;
type With_holes = Part0 | Part1 | Part4 | Part5 | Part8 | Part9;
type With_three = Part2 | Part6 | Part10;

const lines: string[] = [];
function make0(): Part0 { return { kind: 0, own0: "p0", head1: 100, head3: 200, head7: 300, head11: 400, ends: 1100, holes: 1200 }; }
function make1(): Part1 { return { kind: 1, own1: "p1", head3: 201, head7: 301, head11: 401, odd: 1001, holes: 1201 }; }
function make2(): Part2 { return { kind: 2, own2: "p2", head3: 202, head7: 302, head11: 402, three: 1302 }; }
function make3(): Part3 { return { kind: 3, own3: "p3", head7: 303, head11: 403, tail9: 703, middle6: 903, odd: 1003 }; }
function make4(): Part4 { return { kind: 4, own4: "p4", head7: 304, head11: 404, tail9: 704, middle6: 904, holes: 1204 }; }
function make5(): Part5 { return { kind: 5, own5: "p5", head7: 305, head11: 405, tail9: 705, middle2: 805, middle6: 905, odd: 1005, holes: 1205 }; }
function make6(): Part6 { return { kind: 6, own6: "p6", head7: 306, head11: 406, tail9: 706, middle2: 806, middle6: 906, three: 1306 }; }
function make7(): Part7 { return { kind: 7, own7: "p7", head11: 407, tail9: 707, middle6: 907, odd: 1007 }; }
function make8(): Part8 { return { kind: 8, own8: "p8", head11: 408, tail4: 608, tail9: 708, middle6: 908, holes: 1208 }; }
function make9(): Part9 { return { kind: 9, own9: "p9", head11: 409, tail4: 609, tail9: 709, odd: 1009, holes: 1209 }; }
function make10(): Part10 { return { kind: 10, own10: "p10", head11: 410, tail4: 610, tail9: 710, three: 1310 }; }
function make11(): Part11 { return { kind: 11, own11: "p11", tail1: 511, tail4: 611, tail9: 711, odd: 1011, ends: 1111 }; }
const parts: Part[] = [make0(), make1(), make2(), make3(), make4(), make5(), make6(), make7(), make8(), make9(), make10(), make11()];
function read_head1(part: Part): number | undefined { return (part as With_head1).head1; }
function has_head1(part: Part): boolean { return (part as With_head1).head1 !== undefined; }
function bump_head1(part: Part): void { if ((part as With_head1).head1 !== undefined) (part as With_head1).head1 += 1; }
function read_head3(part: Part): number | undefined { return (part as With_head3).head3; }
function has_head3(part: Part): boolean { return (part as With_head3).head3 !== undefined; }
function bump_head3(part: Part): void { if ((part as With_head3).head3 !== undefined) (part as With_head3).head3 += 1; }
function read_head7(part: Part): number | undefined { return (part as With_head7).head7; }
function has_head7(part: Part): boolean { return (part as With_head7).head7 !== undefined; }
function bump_head7(part: Part): void { if ((part as With_head7).head7 !== undefined) (part as With_head7).head7 += 1; }
function read_head11(part: Part): number | undefined { return (part as With_head11).head11; }
function has_head11(part: Part): boolean { return (part as With_head11).head11 !== undefined; }
function bump_head11(part: Part): void { if ((part as With_head11).head11 !== undefined) (part as With_head11).head11 += 1; }
function read_tail1(part: Part): number | undefined { return (part as With_tail1).tail1; }
function has_tail1(part: Part): boolean { return (part as With_tail1).tail1 !== undefined; }
function bump_tail1(part: Part): void { if ((part as With_tail1).tail1 !== undefined) (part as With_tail1).tail1 += 1; }
function read_tail4(part: Part): number | undefined { return (part as With_tail4).tail4; }
function has_tail4(part: Part): boolean { return (part as With_tail4).tail4 !== undefined; }
function bump_tail4(part: Part): void { if ((part as With_tail4).tail4 !== undefined) (part as With_tail4).tail4 += 1; }
function read_tail9(part: Part): number | undefined { return (part as With_tail9).tail9; }
function has_tail9(part: Part): boolean { return (part as With_tail9).tail9 !== undefined; }
function bump_tail9(part: Part): void { if ((part as With_tail9).tail9 !== undefined) (part as With_tail9).tail9 += 1; }
function read_middle2(part: Part): number | undefined { return (part as With_middle2).middle2; }
function has_middle2(part: Part): boolean { return (part as With_middle2).middle2 !== undefined; }
function bump_middle2(part: Part): void { if ((part as With_middle2).middle2 !== undefined) (part as With_middle2).middle2 += 1; }
function read_middle6(part: Part): number | undefined { return (part as With_middle6).middle6; }
function has_middle6(part: Part): boolean { return (part as With_middle6).middle6 !== undefined; }
function bump_middle6(part: Part): void { if ((part as With_middle6).middle6 !== undefined) (part as With_middle6).middle6 += 1; }
function read_odd(part: Part): number | undefined { return (part as With_odd).odd; }
function has_odd(part: Part): boolean { return (part as With_odd).odd !== undefined; }
function bump_odd(part: Part): void { if ((part as With_odd).odd !== undefined) (part as With_odd).odd += 1; }
function read_ends(part: Part): number | undefined { return (part as With_ends).ends; }
function has_ends(part: Part): boolean { return (part as With_ends).ends !== undefined; }
function bump_ends(part: Part): void { if ((part as With_ends).ends !== undefined) (part as With_ends).ends += 1; }
function read_holes(part: Part): number | undefined { return (part as With_holes).holes; }
function has_holes(part: Part): boolean { return (part as With_holes).holes !== undefined; }
function bump_holes(part: Part): void { if ((part as With_holes).holes !== undefined) (part as With_holes).holes += 1; }
function read_three(part: Part): number | undefined { return (part as With_three).three; }
function has_three(part: Part): boolean { return (part as With_three).three !== undefined; }
function bump_three(part: Part): void { if ((part as With_three).three !== undefined) (part as With_three).three += 1; }
function own0(part: Part): string | undefined { return (part as Part0).own0; }
function own1(part: Part): string | undefined { return (part as Part1).own1; }
function own2(part: Part): string | undefined { return (part as Part2).own2; }
function own3(part: Part): string | undefined { return (part as Part3).own3; }
function own4(part: Part): string | undefined { return (part as Part4).own4; }
function own5(part: Part): string | undefined { return (part as Part5).own5; }
function own6(part: Part): string | undefined { return (part as Part6).own6; }
function own7(part: Part): string | undefined { return (part as Part7).own7; }
function own8(part: Part): string | undefined { return (part as Part8).own8; }
function own9(part: Part): string | undefined { return (part as Part9).own9; }
function own10(part: Part): string | undefined { return (part as Part10).own10; }
function own11(part: Part): string | undefined { return (part as Part11).own11; }
function row(part: Part): string {
    return [part.kind, read_head1(part), read_head3(part), read_head7(part), read_head11(part), read_tail1(part), read_tail4(part), read_tail9(part), read_middle2(part), read_middle6(part), read_odd(part), read_ends(part), read_holes(part), read_three(part), has_head1(part) ? 1 : 0, has_head3(part) ? 1 : 0, has_head7(part) ? 1 : 0, has_head11(part) ? 1 : 0, has_tail1(part) ? 1 : 0, has_tail4(part) ? 1 : 0, has_tail9(part) ? 1 : 0, has_middle2(part) ? 1 : 0, has_middle6(part) ? 1 : 0, has_odd(part) ? 1 : 0, has_ends(part) ? 1 : 0, has_holes(part) ? 1 : 0, has_three(part) ? 1 : 0, own0(part), own1(part), own2(part), own3(part), own4(part), own5(part), own6(part), own7(part), own8(part), own9(part), own10(part), own11(part)].join(" ");
}
for (const part of parts) lines.push(row(part));
for (const part of parts) { bump_head1(part); bump_head3(part); bump_head7(part); bump_head11(part); bump_tail1(part); bump_tail4(part); bump_tail9(part); bump_middle2(part); bump_middle6(part); bump_odd(part); bump_ends(part); bump_holes(part); bump_three(part); }
for (const part of parts) lines.push(row(part));
let sum = 0;
for (let round = 0; round < 2000; round++) for (let i = 0; i < parts.length; i++) sum += (read_head7(parts[i]) ?? 1) + (read_tail4(parts[i]) ?? 2) + (read_odd(parts[i]) ?? 3) + (read_middle6(parts[i]) ?? 4);
lines.push(String(sum));
console.log(lines.join("\n"));

// GENERATED: has_head1 own0 make0 bump_head1
// CHECK-LABEL: function {{*}}name="has_head1"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[L_1]] site=[[w_2]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=boolean site=[[w_3]]}] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_1]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Convert v0 declared={type=undefined|null|[[L_4]] site=[[w_5]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=Assertion
// CHECK-NEXT: v2 = PropGet v1 key="head1"
// CHECK-NEXT: v3 = TypeTest v2 testedType=undefined
// CHECK-NEXT: v4 = LogicalNot v3
// CHECK-NEXT: v5 = Convert v4 declared={type=boolean site=[[w_3]]}
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="own0"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[L_1]] site=[[w_6]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|string site=[[w_7]] flags=[OmitsNull]}] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_1]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Convert v0 declared={type=undefined|null|[[L_4]] site=[[w_8]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=Assertion
// CHECK-NEXT: v2 = PropGet v1 key="own0"
// CHECK-NEXT: v3 = Convert v2 declared={type=undefined|null|string site=[[w_7]] flags=[OmitsNull]}
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="make0"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] thisType={type=anything} results=[{type=undefined|null|[[L_4]] site=[[w_9]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = Data data=[[d_10]]
// CHECK-NEXT: v1 = Convert v0 declared={type=undefined|null|[[L_4]] site=[[w_9]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v1
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="bump_head1"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[L_1]] site=[[w_11]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_1]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Convert v0 declared={type=undefined|null|[[L_4]] site=[[w_12]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=Assertion
// CHECK-NEXT: v2 = PropGet v1 key="head1"
// CHECK-NEXT: v3 = TypeTest v2 testedType=undefined
// CHECK-NEXT: Branch v3 -> taken b2(| 0), notTaken b3(| 0)
// CHECK-NEXT: b2(v4):
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b3(v5):
// CHECK-NEXT: Jump -> next b4()
// CHECK-NEXT: b4():
// CHECK-NEXT: v6 = Convert v0 declared={type=undefined|null|[[L_4]] site=[[w_13]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=Assertion
// CHECK-NEXT: v7 = PropGet v6 key="head1"
// CHECK-NEXT: v8 = Integer integer=1
// CHECK-NEXT: v9 = Add v7, v8
// CHECK-NEXT: v10 = Convert v9 declared={type=number site=[[w_14]]}
// CHECK-NEXT: PropSet v6, v10 key="head1"
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5():
// CHECK-NEXT: v12 = Undefined
// CHECK-NEXT: Return v12
// CHECK-NEXT: }
