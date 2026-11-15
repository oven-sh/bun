// RUN: lower
// CHECK-LABEL: function {{*}}name="callResult"
// CHECK-NOT: | 0
// CHECK: Switch {{*}}cases=[1] -> case [[clause]](), otherwise
// CHECK-NOT: | 0
// CHECK-LABEL: function {{*}}name="comparison"
// CHECK: Switch [[compared]] cases=[1] -> case {{*}}(| 0), otherwise
// CHECK: [[null]] = Null
// CHECK-NEXT: [[equal]] = StrictEq [[compared]], [[null]]
// CHECK-NEXT: Branch [[equal]] -> taken [[isNull]](| 0), notTaken [[notNull]](| 0)
// CHECK: [[isNull]]([[nullValue]]):
// CHECK: [[notNull]]([[otherValue]]):
// CHECK-LABEL: function {{*}}name="evaluatedTest"
// CHECK: key="call"
// CHECK: Branch {{*}} -> taken {{*}}(| 0), notTaken [[remaining]](| 0)
// CHECK: [[remaining]]([[rest]]):
// CHECK-NEXT: Switch [[rest]] cases=[1] -> case {{*}}(| 0), otherwise
// CHECK-LABEL: function {{*}}name="local"
// CHECK: Switch {{*}}cases=[1] -> case [[landing]](| 0), otherwise
// CHECK: [[landing]]([[narrowed]]):
// CHECK: [[narrowed]]
// CHECK-LABEL: function {{*}}name="storeInTest"
// CHECK-NOT: | 0
// CHECK: key="call"
// CHECK-NOT: | 0
// CHECK: = StrictEq [[original]], [[stored]]
// CHECK-NOT: | 0
// CHECK: Switch [[original]] cases=[1]
// CHECK-NOT: | 0

declare function call(): number;

export function callResult() {
  switch (call()) {
    case 1:
      return 1;
  }
  return 0;
}

export function comparison(x: unknown) {
  switch (x) {
    case null:
      return x;
    case 1:
      return x;
  }
  return 0;
}

export function evaluatedTest(x: number) {
  switch (x) {
    case call():
      return x;
    case 1:
      return x;
  }
  return 0;
}

export function local(x: number) {
  switch (x) {
    case 1:
      return x;
  }
  return 0;
}

export function storeInTest(x: number) {
  switch (x) {
    case (x = call()):
      return x;
    case 1:
      return x;
  }
  return 0;
}
