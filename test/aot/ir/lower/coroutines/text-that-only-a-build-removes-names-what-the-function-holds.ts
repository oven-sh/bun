// Where a build removes text that `bun run` keeps, a function that can be suspended reads the locals that the text names in its place. Text that `bun run` removes too names nothing, and
// neither does any text of a function that is never suspended.
// RUN: lower
// CHECK-LABEL: function {{*}}name="returnsAtOnce"
// CHECK-NOT: ReadScope
// CHECK-LABEL: function {{*}}name="steps"
// CHECK: [[madeInSteps]] = Call
// CHECK: [[localOfSteps]] = Convert [[madeInSteps]]
// CHECK: = Yield {{*}} @
// CHECK: ReadScope [[localOfSteps]]
// CHECK-LABEL: function {{*}}name="waits"
// CHECK: [[made]] = Call
// CHECK: [[local]] = Convert [[made]]
// CHECK: = Await {{*}} @
// CHECK: ReadScope [[local]]
// CHECK-NOT: ReadScope

declare function make(): { n: number };
declare function pause(): Promise<void>;
declare function use(n: number): void;

const isVerbose = false;

export async function waits() {
  const local = make();
  await pause();
  if (isVerbose) use(local.n);
  if (false) use(local.n);
}

export function* steps() {
  const local = make();
  yield 1;
  isVerbose && use(local.n);
}

export function returnsAtOnce() {
  const local = make();
  if (isVerbose) use(local.n);
}
