// A loop of which one arm awaits is lowered as a loop without a suspension inside an outer loop of the iterations that await. What stands after the arm is lowered in both loops.
// A loop that awaits in every iteration, or whose rest calls or creates functions, stays one loop.
// RUN: lower
// CHECK-LABEL: function {{*}}name="awaitsAlways"
// CHECK: LoopHint
// CHECK-NOT: LoopHint
// CHECK: = Await
// CHECK-LABEL: function {{*}}name="callsAfter"
// CHECK: LoopHint
// CHECK-NOT: LoopHint
// CHECK: = Await
// CHECK-LABEL: function {{*}}name="splits"
// CHECK: LoopHint
// CHECK: Jump -> next [[inner]](
// CHECK: [[inner]](
// CHECK-NEXT: LoopHint
// CHECK: = Await

declare function pause(): Promise<void>;
declare function use(x: number): number;

export async function splits(xs: number[]) {
  let sum = 0;
  for (let i = 0; i < xs.length; i++) {
    sum += xs[i];
    if (i % 100 === 99) await pause();
    sum++;
  }
  return sum;
}

export async function awaitsAlways(xs: number[]) {
  let sum = 0;
  for (let i = 0; i < xs.length; i++) {
    sum += xs[i];
    await pause();
  }
  return sum;
}

export async function callsAfter(xs: number[]) {
  let sum = 0;
  for (let i = 0; i < xs.length; i++) {
    if (i % 100 === 99) await pause();
    sum += use(xs[i]);
  }
  return sum;
}
