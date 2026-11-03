// A mark lets a call go where `bun build` lets it go: where the call is a statement. Its arguments stay for what they do. The engine is not told of the mark: it would let more go.
// RUN: lower
// CHECK-NOT: isAnnotatedPure
// CHECK-LABEL: function {{*}}name="construction"
// CHECK-NOT: = Construct
// CHECK-LABEL: function {{*}}name="head"
// CHECK: = Call {{*}}calleeName="f"
// CHECK-LABEL: function {{*}}name="knownTest"
// CHECK-NOT: calleeName="f"
// CHECK-LABEL: function {{*}}name="local"
// CHECK: = Call {{*}}calleeName="f"
// CHECK-LABEL: function {{*}}name="statement"
// CHECK-NOT: calleeName="f"
// CHECK: = Call {{*}}calleeName="g"
// CHECK-NOT: calleeName="f"
// CHECK-LABEL: function {{*}}name="used"
// CHECK: = Call {{*}}calleeName="f"

export function used(f: any) {
  return /* @__PURE__ */ f();
}

export function statement(f: any, g: any) {
  /* @__PURE__ */ f(g());
  [/* @__PURE__ */ f(), { a: /* @__PURE__ */ f() }];
  /* @__PURE__ */ f() ? 1 : 2;
  /* @__PURE__ */ f() && 1;
  typeof /* @__PURE__ */ f() === void /* @__PURE__ */ f();
}

export function construction(C: any) {
  /* @__PURE__ */ new C();
}

export function local(f: any) {
  const unused = /* @__PURE__ */ f();
}

export function head(f: any) {
  for (/* @__PURE__ */ f(); ; ) break;
}

export function knownTest(f: any) {
  return (/* @__PURE__ */ f(), true) ? 1 : 2;
}
