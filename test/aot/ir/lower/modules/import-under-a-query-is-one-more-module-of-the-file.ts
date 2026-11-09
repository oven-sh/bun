// RUN: link
// CHECK: module {{*}}path="/$bunfs/root/counter.ts" displayPath="counter.ts"
// CHECK: module {{*}}path="/$bunfs/root/counter.ts?again" displayPath="counter.ts"
// CHECK: module {{*}}path="/$bunfs/root/counter.ts?x=1" displayPath="counter.ts"
// CHECK-NOT: module {{*}}path="/$bunfs/root/counter.ts?

// `bun run` makes one more module of the file for each query, and so does an executable. The same query names the same module.
// FILE: main.ts
import { count } from "./counter.ts";
import { count as again } from "./counter.ts?again";
console.log(count, again, await import("./counter.ts?again"), await import("./counter.ts?x=1"));

// FILE: counter.ts
export const count = {};
