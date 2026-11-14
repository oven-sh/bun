// The left side of a comma runs, whatever built-in the right side names and whether or not the value is used.
// RUN: lower
// CHECK-LABEL: function {{*}}name="memberOfComma"
// CHECK: = Call {{*}}calleeName="f"
// CHECK-LABEL: function {{*}}name="statement"
// CHECK: = Call {{*}}calleeName="f"
// CHECK-LABEL: function {{*}}name="step"
// CHECK: = Call {{*}}calleeName="f"
// CHECK-LABEL: function {{*}}name="voided"
// CHECK: = Call {{*}}calleeName="f"

export function statement(f: () => void) {
  f(), Object.keys;
}

export function memberOfComma(f: () => void) {
  (f(), Math).PI;
}

export function voided(f: () => void) {
  return void (f(), Object.keys);
}

export function step(f: () => boolean) {
  for (let more = true; more; more = f(), Math.PI) {}
}
