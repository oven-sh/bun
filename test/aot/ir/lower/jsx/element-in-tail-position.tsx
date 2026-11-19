// An element is a call of the factory, and in strict code a call that a function returns is a call in tail position.
// RUN: lower
// CHECK-LABEL: function {{*}}name="chooses"
// CHECK: [[first]] = Call {{*}}calleeName="jsxDEV"
// CHECK-NEXT: ReturnCall [[first]]
// CHECK: [[second]] = Call {{*}}calleeName="jsxDEV"
// CHECK-NEXT: ReturnCall [[second]]
// CHECK-LABEL: function {{*}}name="keeps"
// CHECK: = Call {{*}}calleeName="jsxDEV"
// CHECK-NOT: ReturnCall
// CHECK-LABEL: function {{*}}name="returns"
// CHECK: [[child]] = Call {{*}}calleeName="jsxDEV"
// CHECK-NOT: ReturnCall [[child]]
// CHECK: [[element]] = Call {{*}}calleeName="jsxDEV"
// CHECK-NEXT: ReturnCall [[element]]

export function returns() {
  return (
    <a>
      <b />
    </a>
  );
}

export function chooses(flag: boolean) {
  return flag ? <a /> : <b />;
}

export function keeps() {
  const element = <a />;
  return [element];
}
