// RUN: lower
// OPTIONS: builtin-modules

// Sites that read by name from objects of a few structures each: whatever places the structures fall on, the answers are the same.
class Base { twice() { return this.value * 2; } }
class Other { twice() { return -this.value; } get extra() { return 7; } }
// Far enough back that `value` is kept outside the object in some, in the object in others.
const kinds = [];
for (let i = 0; i < 48; i++) {
  kinds.push(n => { const o = i % 3 ? new Base() : new Other(); for (let k = 0; k < i % 5 * 4; k++) o["pad" + i + "_" + k] = k; o["own" + i] = i; o.value = n; if (i % 4 === 1 && i % 3) o.extra = i; return o; });
}
function read0(o) { return o.value + (o.extra === undefined ? 0 : o.extra) + o.twice(); }
function read1(o) { return o.value + (o.extra === undefined ? 0 : o.extra) + o.twice(); }
function read2(o) { return o.value + (o.extra === undefined ? 0 : o.extra) + o.twice(); }
function read3(o) { return o.value + (o.extra === undefined ? 0 : o.extra) + o.twice(); }
function read4(o) { return o.value + (o.extra === undefined ? 0 : o.extra) + o.twice(); }
function read5(o) { return o.value + (o.extra === undefined ? 0 : o.extra) + o.twice(); }
function read6(o) { return o.value + (o.extra === undefined ? 0 : o.extra) + o.twice(); }
function read7(o) { return o.value + (o.extra === undefined ? 0 : o.extra) + o.twice(); }
function read8(o) { return o.value + (o.extra === undefined ? 0 : o.extra) + o.twice(); }
function read9(o) { return o.value + (o.extra === undefined ? 0 : o.extra) + o.twice(); }
function read10(o) { return o.value + (o.extra === undefined ? 0 : o.extra) + o.twice(); }
function read11(o) { return o.value + (o.extra === undefined ? 0 : o.extra) + o.twice(); }
function read12(o) { return o.value + (o.extra === undefined ? 0 : o.extra) + o.twice(); }
function read13(o) { return o.value + (o.extra === undefined ? 0 : o.extra) + o.twice(); }
function read14(o) { return o.value + (o.extra === undefined ? 0 : o.extra) + o.twice(); }
function read15(o) { return o.value + (o.extra === undefined ? 0 : o.extra) + o.twice(); }
function read16(o) { return o.value + (o.extra === undefined ? 0 : o.extra) + o.twice(); }
function read17(o) { return o.value + (o.extra === undefined ? 0 : o.extra) + o.twice(); }
function read18(o) { return o.value + (o.extra === undefined ? 0 : o.extra) + o.twice(); }
function read19(o) { return o.value + (o.extra === undefined ? 0 : o.extra) + o.twice(); }
function read20(o) { return o.value + (o.extra === undefined ? 0 : o.extra) + o.twice(); }
function read21(o) { return o.value + (o.extra === undefined ? 0 : o.extra) + o.twice(); }
function read22(o) { return o.value + (o.extra === undefined ? 0 : o.extra) + o.twice(); }
function read23(o) { return o.value + (o.extra === undefined ? 0 : o.extra) + o.twice(); }
const sites = [read0, read1, read2, read3, read4, read5, read6, read7, read8, read9, read10, read11, read12, read13, read14, read15, read16, read17, read18, read19, read20, read21, read22, read23];
let sum = 0;
const objects = kinds.map((make, i) => make(i + 1));
// Site s meets 2 + s % 9 kinds, from the s-th on.
for (let turn = 0; turn < 400; turn++) sites.forEach((read, s) => { for (let k = 0; k < 2 + s % 9; k++) sum += read(objects[(s * 2 + k) % objects.length]); });
console.log(sum);
// What a slot holds ends with the structure, or with what it rests on.
for (const o of objects) { if (o.value % 7 === 0) delete o.value; if (o.value % 5 === 0) o.late = 1; }
Base.prototype.twice = function () { return 1; };
sum = 0;
for (let turn = 0; turn < 40; turn++) sites.forEach((read, s) => { for (let k = 0; k < 2 + s % 9; k++) { const v = read(objects[(s * 2 + k) % objects.length]); sum += Number.isNaN(v) ? 1000 : v; } });
console.log(sum);
Object.defineProperty(Base.prototype, "extra", { get() { return 100; }, configurable: true });
sum = 0;
for (let turn = 0; turn < 40; turn++) sites.forEach((read, s) => { for (let k = 0; k < 2 + s % 9; k++) { const v = read(objects[(s * 2 + k) % objects.length]); sum += Number.isNaN(v) ? 1000 : v; } });
console.log(sum);

// GENERATED: read0 Base twice extra
// CHECK-LABEL: function {{*}}name="read0"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[L_1]] flags=[IsExpected]}] results=[{type=anything}] functionTypes={{*}}[[f_2]]] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_1]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = PropGet v0 key="value"
// CHECK-NEXT: v2 = PropGet v0 key="extra"
// CHECK-NEXT: v3 = TypeTest v2 testedType=undefined
// CHECK-NEXT: Branch v3 -> taken b2(| 0), notTaken b4(| 0)
// CHECK-NEXT: b2(v4):
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3():
// CHECK-NEXT: v5 = Integer
// CHECK-NEXT: Jump -> next b6(v5)
// CHECK-NEXT: b4(v6):
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5():
// CHECK-NEXT: v7 = PropGet v0 key="extra"
// CHECK-NEXT: Jump -> next b6(v7)
// CHECK-NEXT: b6(v8):
// CHECK-NEXT: v9 = Add v1, v8
// CHECK-NEXT: v10 = PropGet v0 key="twice"
// CHECK-NEXT: v11 = Convert v10 declared={type=undefined|null|function flags=[IsExpected]}
// CHECK-NEXT: v12 = Call v11, v0 calleeKey="twice" calleeName="o.twice"
// CHECK-NEXT: v13 = Add v9, v12
// CHECK-NEXT: Return v13
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Base"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, HasExplicitName] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetConstructPrototype v0 layout=[[L_3]]
// CHECK-NEXT: v2 = NewObject v1 layout=[[L_3]]
// CHECK-NEXT: v3 = Convert v2 declared={type=[[L_3]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="twice"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasThis, HasExplicitName] thisType={type=[[L_3]] flags=[IsExpected]} results=[{type=number flags=[IsExpected]}] functionTypes={{*}}[[f_4]]] {
// CHECK-NEXT: b0(v0: [[L_3]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Convert v0 declared={type=undefined|null|[[L_3]] flags=[IsExpected]}
// CHECK-NEXT: v2 = PropGet v1 key="value"
// CHECK-NEXT: v3 = Integer integer=2
// CHECK-NEXT: v4 = Mul v2, v3
// CHECK-NEXT: v5 = Convert v4 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="twice"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasThis, HasExplicitName] thisType={type=[[L_5]] flags=[IsExpected]} results=[{type=number flags=[IsExpected]}] {
// CHECK-NEXT: b0(v0: [[L_5]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Convert v0 declared={type=undefined|null|[[L_5]] flags=[IsExpected]}
// CHECK-NEXT: v2 = PropGet v1 key="value"
// CHECK-NEXT: v3 = Negate v2
// CHECK-NEXT: v4 = Convert v3 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: Return v4
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="extra"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Getter flags=[HasExplicitName] thisType={type=anything} results=[{type=number flags=[IsExpected]}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = Integer integer=7
// CHECK-NEXT: v1 = Convert v0 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: Return v1
// CHECK-NEXT: }
