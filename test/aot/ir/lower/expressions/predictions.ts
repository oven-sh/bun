// RUN: lower
// CHECK-LABEL: function {{*}}name="aliased"
// CHECK: b0([[n]]: {{*}}, [[use]]: anything):
// CHECK: [[property]] = Convert [[n]] declared={type=undefined|null|[[propertyLayout]]} illTypedCause=Assertion
// CHECK-NOT: = Convert [[n]]
// CHECK: = PropGet [[property]] key="object"
// CHECK-NOT: = Convert [[n]]
// CHECK-NOT: = Convert [[property]]
// CHECK: = PropGet [[property]] key="name"
// CHECK-NOT: declared={type=undefined|null|[[propertyLayout]]}
// CHECK: = PropGet {{*}}key="kind"
// CHECK-LABEL: function {{*}}name="array"
// CHECK: [[list]] = Convert [[n]] declared={type=undefined|null|Array<{{*}}>} illTypedCause=Assertion
// CHECK-NOT: = Convert [[n]]
// CHECK: = PropGet [[list]] key="length"
// CHECK-NOT: = Convert [[n]]
// CHECK-NOT: = Convert [[list]]
// CHECK: = ElemGet [[list]],
// CHECK-NOT: declared={type=undefined|null|Array<
// CHECK: Return
// CHECK-LABEL: function {{*}}name="assertion"
// CHECK: [[call]] = Convert [[n]] declared={type=undefined|null|L{{*}}} illTypedCause=Assertion
// CHECK-NOT: = Convert [[n]]
// CHECK: = PropGet [[call]] key="callee"
// CHECK-NOT: = Convert [[n]]
// CHECK-NOT: = Convert [[call]]
// CHECK: = PropGet [[call]] key="count"
// CHECK-LABEL: function {{*}}name="guard"
// CHECK: [[identifier]] = Convert [[n]] declared={type=undefined|null|[[identifierLayout]]} illTypedCause=Assertion
// CHECK-NOT: = Convert [[n]]
// CHECK: = PropGet [[identifier]] key="text"
// CHECK-NOT: = Convert [[n]]
// CHECK-NOT: = Convert [[identifier]]
// CHECK: = PropGet [[identifier]] key="escaped"
// CHECK-NOT: declared={type=undefined|null|[[identifierLayout]]}
// CHECK: = PropGet {{*}}key="kind"

interface Identifier { kind: "identifier"; text: string; escaped: string }
interface Call { kind: "call"; callee: Node; count: number }
interface Property { kind: "property"; object: Node; name: string }
interface Block { kind: "block" }
interface If { kind: "if" }
interface While { kind: "while" }
interface Return { kind: "return" }
interface Throw { kind: "throw" }
interface Literal { kind: "literal" }
interface Spread { kind: "spread" }
type Node = Identifier | Call | Property | Block | If | While | Return | Throw | Literal | Spread;

declare function isIdentifier(n: Node): n is Identifier;
declare function assertIsCall(n: Node): asserts n is Call;

export function aliased(n: Node, use: any) {
  const isProperty = n.kind === "property";
  if (isProperty) {
    use(n.object);
    use(n.name);
  }
  return n.kind;
}

export function array(v: Node | Node[], use: any) {
  if (Array.isArray(v)) {
    use(v.length);
    use(v[0]);
  }
  return v;
}

export function assertion(n: Node, use: any) {
  assertIsCall(n);
  use(n.callee);
  use(n.count);
}

export function guard(n: Node, use: any) {
  if (isIdentifier(n)) {
    use(n.text);
    use(n.escaped);
  }
  return n.kind;
}
