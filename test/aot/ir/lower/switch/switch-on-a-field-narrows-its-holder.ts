// RUN: lower
// CHECK-LABEL: function {{*}}name="booleans"
// CHECK: = PropGet [[flagHolder]] key="ok"
// CHECK: [[isTrue]] = StrictEq
// CHECK-NEXT: Branch [[isTrue]] -> taken [[trueCase]](| 0), notTaken [[notTrue]](| 0)
// CHECK: [[trueCase]]([[trueRead]]):
// CHECK-NEXT: [[succeeded]] = NarrowByField [[flagHolder]], [[trueRead]] key="ok"
// CHECK: [[narrowedToSucceeded]] = Convert [[succeeded]] declared={type=undefined|null|L{{*}}} illTypedCause=Assertion
// CHECK-NEXT: = PropGet [[narrowedToSucceeded]] key="value"
// CHECK: [[notTrue]]([[notTrueRead]]):
// CHECK-NEXT: [[notSucceeded]] = NarrowByField [[flagHolder]], [[notTrueRead]] key="ok"
// CHECK: [[isFalse]] = StrictEq [[notTrueRead]],
// CHECK-NEXT: Branch [[isFalse]] -> taken [[falseCase]](| 0), notTaken {{*}}(| 0)
// CHECK: [[falseCase]]([[falseRead]]):
// CHECK-NEXT: = NarrowByField [[notSucceeded]], [[falseRead]] key="ok"
// CHECK-LABEL: function {{*}}name="callResult"
// CHECK-NOT: | 0
// CHECK: Switch {{*}}cases=[0] -> case [[callClause]](), otherwise
// CHECK-NOT: | 0
// CHECK-LABEL: function {{*}}name="integers"
// CHECK: = PropGet [[holder]] key="kind"
// CHECK: Switch {{*}}cases=[0, 1] -> case [[caseA]](| 0), case [[caseB]](| 0), otherwise
// CHECK: [[caseA]]([[readA]]):
// CHECK-NEXT: [[isA]] = NarrowByField [[holder]], [[readA]] key="kind"
// CHECK: [[narrowedToA]] = Convert [[isA]] declared={type=undefined|null|L{{*}}} illTypedCause=Assertion
// CHECK-NEXT: = PropGet [[narrowedToA]] key="a"
// CHECK: [[caseB]]([[readB]]):
// CHECK-NEXT: [[isB]] = NarrowByField [[holder]], [[readB]] key="kind"
// CHECK: [[narrowedToB]] = Convert [[isB]] declared={type=undefined|null|L{{*}}} illTypedCause=Assertion
// CHECK-NEXT: = PropGet [[narrowedToB]] key="b"
// CHECK-LABEL: function {{*}}name="sharedBody"
// CHECK: = PropGet [[sharedHolder]] key="kind"
// CHECK: Switch {{*}}cases=[0, 1] -> case [[first]](| 0), case [[second]](| 0), otherwise
// CHECK: [[first]]([[firstRead]]):
// CHECK-NEXT: [[firstHolder]] = NarrowByField [[sharedHolder]], [[firstRead]] key="kind"
// CHECK-NEXT: Jump -> next [[body]]([[firstHolder]])
// CHECK: [[second]]([[secondRead]]):
// CHECK-NEXT: [[secondHolder]] = NarrowByField [[sharedHolder]], [[secondRead]] key="kind"
// CHECK-NEXT: Jump -> next [[body]]([[secondHolder]])
// CHECK: [[body]]([[joined]]
// CHECK-NEXT: [[narrowedToEither]] = Convert [[joined]] declared={type=undefined|null|L{{*}}|L{{*}}} illTypedCause=Assertion
// CHECK-NEXT: = PropGet [[narrowedToEither]] key="id"
// CHECK-LABEL: function {{*}}name="storeInTest"
// CHECK-NOT: NarrowByField
// CHECK-LABEL: function {{*}}name="strings"
// CHECK: = PropGet [[shapeHolder]] key="shape"
// CHECK: SwitchString {{*}}strings=["circle", "square"] -> case [[circle]](| 0), case [[square]](| 0), otherwise
// CHECK: [[circle]]([[circleRead]]):
// CHECK-NEXT: = NarrowByField [[shapeHolder]], [[circleRead]] key="shape"
// CHECK: = PropGet {{*}}key="radius"
// CHECK: [[square]]([[squareRead]]):
// CHECK-NEXT: = NarrowByField [[shapeHolder]], [[squareRead]] key="shape"
// CHECK: = PropGet {{*}}key="side"

declare function make(): A | B;

enum K {
  A,
  B,
  C,
}

interface A {
  kind: K.A;
  id: number;
  a: number;
}

interface B {
  kind: K.B;
  id: number;
  b: number;
}

interface C {
  kind: K.C;
  c: number;
}

interface Succeeded {
  ok: true;
  value: number;
}

interface Failed {
  ok: false;
  error: string;
}

interface Circle {
  shape: "circle";
  radius: number;
}

interface Square {
  shape: "square";
  side: number;
}

export function booleans(x: Succeeded | Failed) {
  switch (x.ok) {
    case true:
      return x.value;
    case false:
      return x.error.length;
  }
  return 0;
}

export function callResult() {
  switch (make().kind) {
    case K.A:
      return 1;
  }
  return 0;
}

export function integers(x: A | B | C) {
  switch (x.kind) {
    case K.A:
      return x.a;
    case K.B:
      return x.b;
  }
  return 0;
}

export function sharedBody(x: A | B | C) {
  switch (x.kind) {
    case K.A:
    case K.B:
      return x.id;
  }
  return 0;
}

export function storeInTest(x: A | B, other: A | B) {
  switch (x.kind) {
    case ((x = other), K.A):
      return 1;
  }
  return 0;
}

export function strings(x: Circle | Square) {
  switch (x.shape) {
    case "circle":
      return x.radius;
    case "square":
      return x.side;
  }
  return 0;
}
