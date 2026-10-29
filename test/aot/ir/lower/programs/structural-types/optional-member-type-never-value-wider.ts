// RUN: lower
// OPTIONS: builtin-modules

// An optional member of type never gets a value through a wider type.
type Either = { a: number; b?: never } | { b: string; a?: never };

function which(value: Either): string {
  if (value.a !== undefined) return "a " + value.a + ", b is undefined: " + (value.b === undefined);
  return "b " + value.b + ", a is undefined: " + (value.a === undefined);
}

const first: Either = { a: 1 };
const second: Either = { b: "two" };
console.log(which(first));
console.log(which(second));
const wide: { a: number; b?: unknown } = { a: 3 };
const narrow: { a: number; b?: never } = { a: 4 };
const alias: { a: number; b?: unknown } = narrow;
alias.b = "both";
wide.b = "unused";
console.log(which(narrow));
console.log(Object.keys(narrow).join(), String(narrow.b), typeof narrow.b);

// GENERATED: which
// CHECK-LABEL: function {{*}}name="which"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[L_1]] site=[[w_2]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|string site=[[w_3]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_1]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = PropGet v0 key="a"
// CHECK-NEXT: v2 = TypeTest v1 testedType=undefined
// CHECK-NEXT: Branch v2 -> taken b2(| 0), notTaken b4(| 0)
// CHECK-NEXT: b2(v3):
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3():
// CHECK-NEXT: v4 = String string="b "
// CHECK-NEXT: v5 = PropGet v0 key="b"
// CHECK-NEXT: v6 = Convert v5 declared={type=undefined|null|string site=[[w_4]]} illTypedCause=Assertion
// CHECK-NEXT: v7 = Add v4, v6
// CHECK-NEXT: v8 = String string=", a is undefined: "
// CHECK-NEXT: v9 = Add v7, v8
// CHECK-NEXT: v10 = PropGet v0 key="a"
// CHECK-NEXT: v11 = TypeTest v10 testedType=undefined
// CHECK-NEXT: v12 = Add v9, v11
// CHECK-NEXT: v13 = Convert v12 declared={type=undefined|null|string site=[[w_3]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v13
// CHECK-NEXT: b4(v14):
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5():
// CHECK-NEXT: v15 = String string="a "
// CHECK-NEXT: v16 = PropGet v0 key="a"
// CHECK-NEXT: v17 = Convert v16 declared={type=number site=[[w_5]]} illTypedCause=Assertion
// CHECK-NEXT: v18 = Add v15, v17
// CHECK-NEXT: v19 = String string=", b is undefined: "
// CHECK-NEXT: v20 = Add v18, v19
// CHECK-NEXT: v21 = PropGet v0 key="b"
// CHECK-NEXT: v22 = TypeTest v21 testedType=undefined
// CHECK-NEXT: v23 = Add v20, v22
// CHECK-NEXT: v24 = Convert v23 declared={type=undefined|null|string site=[[w_3]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v24
// CHECK-NEXT: }
