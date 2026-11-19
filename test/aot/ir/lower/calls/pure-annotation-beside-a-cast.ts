// `bun build` looks for the mark where it starts to parse an expression, and it drops casts and parentheses as it parses. What stands behind `<T>` goes on the expression that the cast starts:
// a mark in front of the cast is the operand's, and a mark between the two is nobody's.
// RUN: lower
// CHECK-LABEL: function {{*}}name="behindTheCast"
// CHECK-COUNT-7: = Call {{*}}calleeName="f"
// CHECK-NOT: calleeName="f"
// CHECK-LABEL: function {{*}}name="castBehindTheCall"
// CHECK-NOT: calleeName="f"
// CHECK-COUNT-3: = Call {{*}}calleeName="g"
// CHECK-NOT: calleeName="f"
// CHECK-LABEL: function {{*}}name="castInParentheses"
// CHECK-NOT: calleeName="f"
// CHECK-LABEL: function {{*}}name="castOfWhatStays"
// CHECK: [[value]] = Call {{*}}calleeName="f"
// CHECK: = Convert [[value]] declared={type={{*}}number}
// CHECK-LABEL: function {{*}}name="construction"
// CHECK-NOT: = Construct
// CHECK-LABEL: function {{*}}name="inFrontOfTheCast"
// CHECK-NOT: calleeName="f"
// CHECK-LABEL: function {{*}}name="notACall"
// CHECK-COUNT-3: = Call {{*}}calleeName="f"
// CHECK-NOT: calleeName="f"
// CHECK-LABEL: function {{*}}name="startsInParentheses"
// CHECK-NOT: calleeName="f"

export function inFrontOfTheCast(f: any) {
  /* @__PURE__ */ <any>f();
  // @__PURE__
  <any>f(); // @ts-expect-error
  /* @__PURE__ */ <const>f();
  /* @__PURE__ */ <any><unknown>f();
  /* @__PURE__ */ <any>(f());
  /* @__PURE__ */ <any>(f() as unknown);
  /* @__PURE__ */ <any>f<number>();
  /* @__PURE__ */ <any>f?.();
  /* @__PURE__ */ <any>f()();
  /* @__PURE__ */ <any>(f())();
  typeof /* @__PURE__ */ <any>f();
  /* @__PURE__ */ <any>/* @__PURE__ */ f();
}

export function construction(C: any) {
  /* @__PURE__ */ <any>new C();
}

export function castBehindTheCall(f: any, g: any) {
  /* @__PURE__ */ f() as any;
  /* @__PURE__ */ f() as number;
  /* @__PURE__ */ f(g()) as any;
  [/* @__PURE__ */ f() as any];
  void (/* @__PURE__ */ f() as any);
  g() ? (/* @__PURE__ */ f() as any) : 2;
  g() && (/* @__PURE__ */ f() as any);
  (/* @__PURE__ */ f() as any), 1;
}

export function castInParentheses(f: any) {
  /* @__PURE__ */ (f() as any);
  /* @__PURE__ */ (f() satisfies any);
  // @ts-expect-error
  /* @__PURE__ */ (f() as const);
  /* @__PURE__ */ ((f() as any) as unknown);
  /* @__PURE__ */ (<any>f());
  /* @__PURE__ */ (<any>(f()));
}

// A cast may test the value of its operand, so it stays where the operand stays whole.
export function castOfWhatStays(f: any) {
  f() as number;
}

export function startsInParentheses(f: any) {
  <any>(/* @__PURE__ */ f());
  <any>(/* @__PURE__ */ <unknown>f());
}

export function behindTheCast(f: any) {
  <any>/* @__PURE__ */ f();
  // @ts-expect-error
  <const>/* @__PURE__ */ f();
  <any>/* @__PURE__ */ (f());
  <any>/* @__PURE__ */ <unknown>f();
  <any><unknown>/* @__PURE__ */ f();
  <Array<any>>/* @__PURE__ */ f();
  (<any>/* @__PURE__ */ f());
}

export function notACall(f: any) {
  /* @__PURE__ */ <any>f().member;
  /* @__PURE__ */ <any>-f();
  /* @__PURE__ */ (f().member as any);
}
