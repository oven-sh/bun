// RUN: lower
// CHECK-LABEL: function {{*}}name="bothEdges"
// CHECK: = PropGet [[holder]] key="kind"
// CHECK: [[test]] = StrictEq
// CHECK-NEXT: Branch [[test]] -> taken [[taken]](| 0), notTaken [[other]](| 0)
// CHECK: [[taken]]([[read]]):
// CHECK-NEXT: [[narrowed]] = NarrowByField [[holder]], [[read]] key="kind"
// CHECK: [[a]] = Convert [[narrowed]] declared={type=undefined|null|L{{*}}} illTypedCause=Assertion
// CHECK-NEXT: = PropGet [[a]] key="a"
// CHECK: [[other]]([[otherRead]]):
// CHECK-NEXT: [[remaining]] = NarrowByField [[holder]], [[otherRead]] key="kind"
// CHECK: [[b]] = Convert [[remaining]] declared={type=undefined|null|L{{*}}} illTypedCause=Assertion
// CHECK-NEXT: = PropGet [[b]] key="b"
// CHECK-LABEL: function {{*}}name="capturedHolder"
// CHECK-NOT: NarrowByField
// CHECK-LABEL: function {{*}}name="chain"
// CHECK: Branch {{*}} -> taken {{*}}(| 0), notTaken [[chainRest]](| 0)
// CHECK: [[chainRest]]([[chainRestRead]]):
// CHECK-NEXT: = NarrowByField {{*}}, [[chainRestRead]] key="kind"
// CHECK: = PropGet [[chainSecondHolder]] key="kind"
// CHECK: Branch {{*}} -> taken [[chainTaken]](| 0), notTaken {{*}}(| 0)
// CHECK: [[chainTaken]]([[chainRead]]):
// CHECK-NEXT: = NarrowByField [[chainSecondHolder]], [[chainRead]] key="kind"
// CHECK-LABEL: function {{*}}name="computedKey"
// CHECK-NOT: NarrowByField
// CHECK-LABEL: function {{*}}name="constantKey"
// CHECK: = PropGet [[keyHolder]] key="kind"
// CHECK: Branch {{*}} -> taken [[keyTaken]](| 0), notTaken {{*}}(| 0)
// CHECK: [[keyTaken]]([[keyRead]]):
// CHECK-NEXT: = NarrowByField [[keyHolder]], [[keyRead]] key="kind"
// CHECK-LABEL: function {{*}}name="looseEquality"
// CHECK-NOT: NarrowByField
// CHECK-LABEL: function {{*}}name="memberHolder"
// CHECK-NOT: NarrowByField
// CHECK-LABEL: function {{*}}name="mirrored"
// CHECK: = PropGet [[mirroredHolder]] key="kind"
// CHECK: [[mirroredTest]] = StrictEq
// CHECK-NEXT: Branch [[mirroredTest]] -> taken [[mirroredTaken]](| 1), notTaken {{*}}(| 1)
// CHECK: [[mirroredTaken]]([[mirroredRead]]):
// CHECK-NEXT: = NarrowByField [[mirroredHolder]], [[mirroredRead]] key="kind"
// CHECK-LABEL: function {{*}}name="negated"
// CHECK: = PropGet [[shapeHolder]] key="shape"
// CHECK: [[sameShape]] = StrictEq
// CHECK-NEXT: Branch [[sameShape]] -> taken [[isCircle]](| 0), notTaken [[isNotCircle]](| 0)
// CHECK: [[isCircle]]([[circleRead]]):
// CHECK-NEXT: = NarrowByField [[shapeHolder]], [[circleRead]] key="shape"
// CHECK: = PropGet {{*}}key="radius"
// CHECK: [[isNotCircle]]([[notCircleRead]]):
// CHECK-NEXT: = NarrowByField [[shapeHolder]], [[notCircleRead]] key="shape"
// CHECK: = PropGet {{*}}key="side"
// CHECK-LABEL: function {{*}}name="optionalLink"
// CHECK-NOT: NarrowByField
// CHECK-LABEL: function {{*}}name="relational"
// CHECK-NOT: NarrowByField

enum K {
  A,
  B,
  C,
}

interface A {
  kind: K.A;
  a: number;
}

interface B {
  kind: K.B;
  b: number;
}

interface C {
  kind: K.C;
  c: number;
}

interface Box {
  item: A | B;
}

interface Circle {
  shape: "circle";
  radius: number;
}

interface Square {
  shape: "square";
  side: number;
}

export function bothEdges(x: A | B) {
  if (x.kind === K.A) return x.a;
  return x.b;
}

export function capturedHolder(first: A | B, second: A | B) {
  let x = first;
  const swap = () => {
    x = second;
  };
  if (x.kind === K.A) return 1;
  return swap;
}

export function chain(x: A | B | C) {
  if (x.kind === K.A) return x.a;
  if (x.kind === K.B) return x.b;
  return x.c;
}

export function computedKey(x: A | B, key: "kind") {
  if (x[key] === K.A) return 1;
  return 0;
}

export function constantKey(x: A | B) {
  if (x["kind"] === K.A) return 1;
  return 0;
}

export function looseEquality(x: A | B) {
  if (x.kind == K.A) return 1;
  return 0;
}

export function memberHolder(box: Box) {
  if (box.item.kind === K.A) return 1;
  return 0;
}

export function mirrored(x: A | B) {
  if (K.A === x.kind) return 1;
  return 0;
}

export function negated(x: Circle | Square) {
  if (x.shape !== "circle") return x.side;
  return x.radius;
}

export function optionalLink(x: A | B | undefined) {
  if (x?.kind === K.A) return 1;
  return 0;
}

export function relational(x: A | B) {
  if (x.kind < K.B) return 1;
  return 0;
}
