// RUN: lower
// CHECK-LABEL: function {{*}}name="afterFoldedReturn"
// CHECK: integer=1
// CHECK-NOT: "dropped"
// CHECK-NOT: integer=2
// CHECK-LABEL: function {{*}}name="afterUnknownTest"

// RUN(HOISTED): lower
// HOISTED-LABEL: function {{*}}name="keepsHoistedFunction"
// HOISTED: NewClosure
// HOISTED: Return
// HOISTED-NOT: "dropped"
// HOISTED: function {{*}}name="later"
// HOISTED: "kept"

// RUN(LOOP): lower
// LOOP-LABEL: function {{*}}name="afterContinue"
// LOOP-NOT: "dropped"
// LOOP: "kept"
// LOOP-NOT: "dropped"
// LOOP: Return

// RUN(REACHED): lower
// REACHED-LABEL: function {{*}}name="afterUnknownTest"
// REACHED: "kept"

// What follows, in its list, a statement that always leaves the list is not lowered. A function declaration there is created where the list is entered.
declare function use(text: string): void;

export function afterFoldedReturn(): number {
  if (true) {
    return 1;
  }
  use("dropped");
  return 2;
}

export function keepsHoistedFunction(): void {
  return later();
  use("dropped");
  function later() {
    use("kept");
  }
}

export function afterContinue(items: number[]): void {
  for (const item of items) {
    if (item === 0) {
      continue;
      use("dropped");
    }
    use("kept");
  }
}

export function afterUnknownTest(flag: boolean): void {
  if (flag) {
    return;
  }
  use("kept");
}
