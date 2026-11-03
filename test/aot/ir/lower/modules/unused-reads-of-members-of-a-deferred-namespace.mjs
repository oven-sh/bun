// The first read of a member of `import defer * as later` runs the file, so each read stays where nothing takes its value. A read of `import * as now` does nothing and goes.
// RUN: lower
// CHECK: [[later]] = ModuleNamespace {{*}}phase=Defer
// CHECK: PropGet {{*}}key="first" @
// CHECK: PropGet {{*}}key="second" @
// CHECK: PropGet {{*}}key="third" @
// CHECK-NOT: PropGet {{*}}key="fourth"
// CHECK: Return

// FILE: main.mjs
import defer * as later from "./later.mjs";
import * as now from "./now.mjs";
later.first;
void later["second"];
const unread = later.third;
now.fourth;

// FILE: later.mjs
export const first = 1;
export const second = 2;
export const third = 3;

// FILE: now.mjs
export const fourth = 4;
