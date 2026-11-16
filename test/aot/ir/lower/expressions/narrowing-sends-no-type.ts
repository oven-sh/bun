// RUN: lower
// What the checker narrows a name to is not sent: behind the test each read takes the parameter as it arrived, or, behind a test that the engine can take at its word, under a name that claims no type: NarrowByTest.
// CHECK-LABEL: function {{*}}name="aliased"
// CHECK: b0([[n]]: {{*}}, [[use]]: anything):
// CHECK-NOT: = Convert [[n]]
// CHECK: = PropGet [[n]] key="object"
// CHECK-NOT: = Convert [[n]]
// CHECK: = PropGet [[n]] key="name"
// CHECK-NOT: = Convert [[n]]
// CHECK: = PropGet [[n]] key="kind"
// CHECK-LABEL: function {{*}}name="array"
// CHECK-NOT: = Convert [[n]]
// CHECK: = Call {{*}}calleeName="Array.isArray"
// CHECK: [[list]] = NarrowByTest [[n]],
// CHECK-NEXT: = PropGet [[list]] key="length"
// CHECK-NOT: = Convert [[n]]
// CHECK: = ElemGet [[list]],
// CHECK-NOT: = Convert [[n]]
// CHECK: Return [[n]]
// CHECK-LABEL: function {{*}}name="assertion"
// CHECK-NOT: = Convert [[n]]
// CHECK: = PropGet [[n]] key="callee"
// CHECK-NOT: = Convert [[n]]
// CHECK: = PropGet [[n]] key="count"
// CHECK-LABEL: function {{*}}name="guard"
// CHECK-NOT: = Convert [[n]]
// CHECK: = PropGet [[n]] key="text"
// CHECK-NOT: = Convert [[n]]
// CHECK: = PropGet [[n]] key="escaped"
// CHECK-NOT: = Convert [[n]]
// CHECK: = PropGet [[n]] key="kind"

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
