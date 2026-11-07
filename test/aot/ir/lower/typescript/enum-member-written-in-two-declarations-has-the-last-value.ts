// One name in two declarations of an enum: each declaration stores over the entry of the one before, so `bun run` has the last value in place of every read, in front of the later declaration too. No name reaches the later member.
// RUN: lower
// CHECK-LABEL: function {{*}}kind=Module
// CHECK: [[early]] = Integer integer=5 @
// CHECK-NEXT: = Call {{*}}, [[early]] calleeName="use"
// CHECK: = String string="last"
// CHECK: [[once]] = Integer integer=2 @
// CHECK-NEXT: = Call {{*}}, [[once]] calleeName="use"

// RUN(DECIDED): lower
// DECIDED-NOT: = String string="first"
// DECIDED-NOT: PropGet {{*}}key="Low"

declare function use(...values: unknown[]): void;

enum Level { // @ts-expect-error
  Low = 1,
  High = 2,
}

use(Level.Low);

enum Level {
  // @ts-expect-error
  Low = 5,
}

// @ts-expect-error
if (Level.Low === 5) use("last");
else use("first");
use(Level.High);
