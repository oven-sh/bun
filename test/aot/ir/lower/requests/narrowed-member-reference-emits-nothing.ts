// RUN: lower
// CHECK-LABEL: function {{*}}name="byDiscriminant"
// CHECK: [[wide]] = PropGet {{*}}key="name"
// CHECK-NEXT: = PropGet [[wide]] key="kind"
// CHECK: Branch
// CHECK: [[discriminated]] = PropGet {{*}}key="name"
// CHECK-NEXT: = PropGet [[discriminated]] key="text"
// CHECK-LABEL: function {{*}}name="byGuard"
// CHECK: [[argument]] = PropGet {{*}}key="name"
// CHECK-NEXT: = Call {{*}}, -, [[argument]] calleeName="isIdentifier"
// CHECK: Branch
// CHECK: [[guarded]] = PropGet {{*}}key="name"
// CHECK-NEXT: = PropGet [[guarded]] key="text"
// CHECK-LABEL: function {{*}}name="byTypeof"
// CHECK: [[tested]] = PropGet {{*}}key="value"
// CHECK-NEXT: = TypeTest [[tested]] testedType=number
// CHECK: Branch
// CHECK: [[number]] = PropGet {{*}}key="value"
// CHECK: = Add [[number]],
// CHECK-LABEL: function {{*}}name="throughTwoMembers"
// CHECK: Branch
// CHECK: [[inner]] = PropGet {{*}}key="declaration"
// CHECK-NEXT: [[deep]] = PropGet [[inner]] key="name"
// CHECK-NEXT: = PropGet [[deep]] key="text"
// CHECK-LABEL: function {{*}}name="underConstantKey"
// CHECK: Branch
// CHECK: [[keyed]] = PropGet {{*}}key="name"
// CHECK-NEXT: = PropGet [[keyed]] key="text"

// RUN(CONVERTS): lower
// CONVERTS-LABEL: function {{*}}name="byDiscriminant"
// CONVERTS-NOT: Convert
// CONVERTS-LABEL: function {{*}}name="byGuard"
// CONVERTS-NOT: Convert
// CONVERTS-LABEL: function {{*}}name="byTypeof"
// CONVERTS-NOT: Convert
// CONVERTS-LABEL: function {{*}}name="throughTwoMembers"
// CONVERTS-NOT: Convert
// CONVERTS-LABEL: function {{*}}name="underConstantKey"
// CONVERTS-NOT: Convert
// CONVERTS-LABEL: function {{*}}name="isIdentifier"
// CONVERTS: = Convert {{*}}declared={type=boolean}

// The checker narrows a path of members as it narrows a variable, and nothing of that is sent. A read of the path behind the test is used as it is, like the read in front of the test and the member on the way to it, and what follows reads from it. `x["name"]` is `x.name`. A value is converted only to what is written: the result of `isIdentifier`.
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
