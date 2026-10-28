// RUN: lower
// CHECK-LABEL: function {{*}}name="doLoop"
// CHECK: key="use"
// CHECK: Jump -> next [[doHeader]]()
// CHECK-NEXT: [[doHeader]]():
// CHECK-NEXT: LoopHint
// CHECK: key="call"
// CHECK: Jump -> next [[doContinue]]()
// CHECK-NEXT: [[doContinue]]():
// CHECK-NEXT: Jump -> next [[doTest]]()
// CHECK: integer=1
// CHECK: [[doTest]]():
// CHECK-NOT: LoopHint
// CHECK: key="flag"
// CHECK-LABEL: function {{*}}name="forLoop"
// CHECK: key="use"
// CHECK: Jump -> next [[forHeader]]()
// CHECK-NEXT: [[forHeader]]():
// CHECK-NEXT: LoopHint
// CHECK: key="call"
// CHECK: Jump -> next [[forContinue]]()
// CHECK-NEXT: [[forContinue]]():
// CHECK-NEXT: Jump -> next [[forUpdate]]()
// CHECK: integer=1
// CHECK: [[forUpdate]]():
// CHECK-NOT: LoopHint
// CHECK: integer=2
// CHECK: Jump -> next [[forHeader]]()
// CHECK-LABEL: function {{*}}name="whileLoop"
// CHECK: key="use"
// CHECK: Jump -> next [[whileHeader]]()
// CHECK-NEXT: [[whileHeader]]():
// CHECK-NEXT: LoopHint
// CHECK: key="call"
// CHECK: Jump -> next [[whileContinue]]()
// CHECK-NEXT: [[whileContinue]]():
// CHECK-NEXT: Jump -> next [[whileHeader]]()
// CHECK: integer=1

declare function use(value: unknown): void;
declare function call(): number;
declare const flag: boolean;

export function doLoop() {
  use(0);
  do {
    if (call()) continue;
    use(1);
  } while (flag);
}

export function forLoop() {
  use(0);
  for (; flag; use(2)) {
    if (call()) continue;
    use(1);
  }
}

export function whileLoop() {
  use(0);
  while (flag) {
    if (call()) continue;
    use(1);
  }
}
