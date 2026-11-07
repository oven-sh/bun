// RUN: lower
// OPTIONS: builtin-modules

// Text evaluated at run time stores undefined and null over a number and a boolean of a typed record. Object.assign carries them onto a copy by spread of a record of the same type.
type P = { x: number; y: number; on: boolean };
const poke = new Function("o", "o.x = undefined; o.on = null;") as (o: object) => void;
const look = new Function("o", "return typeof o.x + ' ' + String(o.on);") as (o: object) => string;
function make(i: number): P { return { x: i + 0.5, y: i * 2, on: true }; }
function merge(a: P, b: P): P { const c = { ...a }; Object.assign(c, b); return c; }
function read(p: P): string { return String(p.x) + "," + (p.x + p.y) + "," + String(p.on) + "," + (p.on ? "yes" : "no"); }
const out: string[] = [];
for (let i = 0; i < 8; i++) {
  const source = make(i);
  if (i >= 4) poke(source);
  const merged = merge(make(100 + i), source);
  out.push(read(merged) + " | " + look(merged));
}
console.log(out.join("\n"));

// GENERATED: make merge read
// CHECK-LABEL: function {{*}}name="make"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=number site=[[w_1]]}] results=[{type=undefined|null|[[L_2]] site=[[w_3]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: number):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Double number=0.5
// CHECK-NEXT: v2 = Add v0, v1
// CHECK-NEXT: v3 = Convert v2 declared={type=number}
// CHECK-NEXT: v4 = Integer integer=2
// CHECK-NEXT: v5 = Mul v0, v4
// CHECK-NEXT: v6 = Convert v5 declared={type=number}
// CHECK-NEXT: v7 = Boolean boolean=true
// CHECK-NEXT: v8 = Convert v7 declared={type=boolean}
// CHECK-NEXT: v9 = NewObject -, v3, v6, v8 layout=[[L_2]] fields=[1, 2, 0]
// CHECK-NEXT: v10 = FinishObject v9
// CHECK-NEXT: v11 = Convert v10 declared={type=undefined|null|[[L_2]] site=[[w_3]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v11
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="merge"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=2 thisType={type=anything} parameters=[{type=undefined|null|[[L_2]] site=[[w_4]] flags=[OmitsNull, OmitsUndefined]}, {type=undefined|null|[[L_2]] site=[[w_5]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|[[L_2]] site=[[w_6]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_2]], v1: undefined|null|[[L_2]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = NewObject layout=[[L_2]]
// CHECK-NEXT: CopyDataProperties v2, v0
// CHECK-NEXT: v4 = FinishObject v2
// CHECK-NEXT: v5 = Convert v4 declared={type=undefined|null|[[L_2]] site=[[w_7]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v6 = Builtin builtin=Object
// CHECK-NEXT: v7 = Builtin builtin=ObjectAssign
// CHECK-NEXT: v8 = Call v7, v6, v5, v1 calleeName="Object.assign"
// CHECK-NEXT: v9 = Convert v8 declared={type=undefined|null|[[L_2]] site=[[w_8]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=FromLooseType
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="read"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[L_2]] site=[[w_9]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|string site=[[w_10]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_2]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Builtin builtin=String
// CHECK-NEXT: v2 = PropGet v0 key="x"
// CHECK-NEXT: v3 = Call v1, -, v2 calleeName="String"
// CHECK-NEXT: v4 = Convert v3 declared={type=undefined|null|string site=[[w_11]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v5 = String string=","
// CHECK-NEXT: v6 = Add v4, v5
// CHECK-NEXT: v7 = PropGet v0 key="x"
// CHECK-NEXT: v8 = PropGet v0 key="y"
// CHECK-NEXT: v9 = Add v7, v8
// CHECK-NEXT: v10 = Add v6, v9
// CHECK-NEXT: v11 = String string=","
// CHECK-NEXT: v12 = Add v10, v11
// CHECK-NEXT: v13 = Builtin builtin=String
// CHECK-NEXT: v14 = PropGet v0 key="on"
// CHECK-NEXT: v15 = Call v13, -, v14 calleeName="String"
// CHECK-NEXT: v16 = Convert v15 declared={type=undefined|null|string site=[[w_12]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v17 = Add v12, v16
// CHECK-NEXT: v18 = String string=","
// CHECK-NEXT: v19 = Add v17, v18
// CHECK-NEXT: v20 = PropGet v0 key="on"
// CHECK-NEXT: v21 = ToBoolean v20
// CHECK-NEXT: Branch v21 -> taken b2(| 0), notTaken b4(| 0)
// CHECK-NEXT: b2(v22):
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3():
// CHECK-NEXT: v23 = String string="yes"
// CHECK-NEXT: Jump -> next b6(v23)
// CHECK-NEXT: b4(v24):
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5():
// CHECK-NEXT: v25 = String string="no"
// CHECK-NEXT: Jump -> next b6(v25)
// CHECK-NEXT: b6(v26):
// CHECK-NEXT: v27 = Add v19, v26
// CHECK-NEXT: v28 = Convert v27 declared={type=undefined|null|string site=[[w_10]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v28
// CHECK-NEXT: }
