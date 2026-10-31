// RUN: link
// CHECK: layout [[identifier]] name="Identifier"
// CHECK: function {{*}}name="byDiscriminant" module=
// CHECK: [[wide]] = PropGet {{*}}key="name"
// CHECK-NEXT: = PropGet [[wide]] key="kind"
// CHECK: Branch
// CHECK: [[discriminatedRead]] = PropGet {{*}}key="name"
// CHECK-NEXT: [[discriminated]] = Convert [[discriminatedRead]] declared={type=undefined|null|[[identifier]]} illTypedCause=Assertion
// CHECK-NEXT: = PropGet [[discriminated]] key="text"
// CHECK: function {{*}}name="byGuard" module=
// CHECK: [[argument]] = PropGet {{*}}key="name"
// CHECK-NOT: = Convert [[argument]]
// CHECK: Branch
// CHECK: [[guardedRead]] = PropGet {{*}}key="name"
// CHECK-NEXT: [[guarded]] = Convert [[guardedRead]] declared={type=undefined|null|[[identifier]]} illTypedCause=Assertion
// CHECK-NEXT: = PropGet [[guarded]] key="text"
// CHECK: function {{*}}name="byTypeof" module=
// CHECK: [[tested]] = PropGet {{*}}key="value"
// CHECK-NEXT: = TypeTest [[tested]] testedType=number
// CHECK: Branch
// CHECK: [[numberRead]] = PropGet {{*}}key="value"
// CHECK-NEXT: [[number]] = Convert [[numberRead]] declared={type=number} illTypedCause=Assertion
// CHECK: = Add [[number]],
// CHECK: function {{*}}name="throughTwoMembers" module=
// CHECK: Branch
// CHECK: [[inner]] = PropGet {{*}}key="declaration"
// CHECK-NEXT: [[deepRead]] = PropGet [[inner]] key="name"
// CHECK-NEXT: [[deep]] = Convert [[deepRead]] declared={type=undefined|null|[[identifier]]} illTypedCause=Assertion
// CHECK-NEXT: = PropGet [[deep]] key="text"
// CHECK: function {{*}}name="underConstantKey" module=
// CHECK: Branch
// CHECK: [[keyedRead]] = PropGet {{*}}key="name"
// CHECK-NEXT: [[keyed]] = Convert [[keyedRead]] declared={type=undefined|null|[[identifier]]} illTypedCause=Assertion
// CHECK-NEXT: = PropGet [[keyed]] key="text"

// The checker narrows a path of members as it narrows a variable. A read of the path whose type at that place is narrower than the type of the field is converted to that type, and what follows reads from the converted value. The conversion has no site. No family covers a narrowing, so it has the cause of an assertion and the engine tests it at each read. In front of the test the read has the type of the field and is used as it is, and so is the member on the way to the narrowed one. `x["name"]` is `x.name`.
interface Identifier {
  kind: 1;
  text: string;
}

interface Literal {
  kind: 2;
  value: number;
}

interface Declaration {
  name: Identifier | Literal;
}

interface Statement {
  declaration: Declaration;
}

function isIdentifier(node: Identifier | Literal): node is Identifier {
  return node.kind === 1;
}

export function byDiscriminant(declaration: Declaration) {
  return declaration.name.kind === 1 ? declaration.name.text : "";
}

export function byGuard(declaration: Declaration) {
  return isIdentifier(declaration.name) ? declaration.name.text : "";
}

export function byTypeof(holder: { value: number | string }) {
  return typeof holder.value === "number" ? holder.value + 1 : 0;
}

export function throughTwoMembers(statement: Statement) {
  return isIdentifier(statement.declaration.name) ? statement.declaration.name.text : "";
}

export function underConstantKey(declaration: Declaration) {
  return isIdentifier(declaration["name"]) ? declaration["name"].text : "";
}
