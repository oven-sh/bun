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
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[L_1]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_1]]):
// CHECK-NEXT: v1 = PropGet v0 key="a"
// CHECK-NEXT: v2 = TypeTest v1 testedType=undefined
// CHECK-NEXT: Branch v2 -> taken b1(| 0), notTaken b2(| 0)
// CHECK-NEXT: b1(v3):
// CHECK-NEXT: v4 = String string="b "
// CHECK-NEXT: v5 = PropGet v0 key="b"
// CHECK-NEXT: v6 = Add v4, v5
// CHECK-NEXT: v7 = String string=", a is undefined: "
// CHECK-NEXT: v8 = Add v6, v7
// CHECK-NEXT: v9 = PropGet v0 key="a"
// CHECK-NEXT: v10 = TypeTest v9 testedType=undefined
// CHECK-NEXT: v11 = Add v8, v10
// CHECK-NEXT: v12 = Convert v11 declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v12
// CHECK-NEXT: b2(v13):
// CHECK-NEXT: v14 = String string="a "
// CHECK-NEXT: v15 = PropGet v0 key="a"
// CHECK-NEXT: v16 = Add v14, v15
// CHECK-NEXT: v17 = String string=", b is undefined: "
// CHECK-NEXT: v18 = Add v16, v17
// CHECK-NEXT: v19 = PropGet v0 key="b"
// CHECK-NEXT: v20 = TypeTest v19 testedType=undefined
// CHECK-NEXT: v21 = Add v18, v20
// CHECK-NEXT: v22 = Convert v21 declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v22
// CHECK-NEXT: }
