// RUN: lower
// CHECK-LABEL: function {{*}}name="continueInner"
// CHECK-COUNT-2: LoopHint
// CHECK-NOT: Increment
// CHECK-LABEL: function {{*}}name="continueOuter"
// CHECK-COUNT-2: LoopHint
// CHECK: Jump -> next [[body]]()
// CHECK-NEXT: [[body]]():
// CHECK-NEXT: Jump -> next [[update]](
// CHECK: [[update]]({{*}}):
// CHECK-NOT: LoopHint
// CHECK: Increment

declare const flag: boolean;

export function continueInner() {
  for (let i = 0; flag; i++) {
    for (;;) {
      continue;
    }
  }
}

export function continueOuter() {
  outer: for (let i = 0; flag; i++) {
    for (;;) {
      continue outer;
    }
  }
}
