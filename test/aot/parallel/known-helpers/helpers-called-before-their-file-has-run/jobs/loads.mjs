import { drainMicrotasks } from "bun:jsc";
globalThis.late = import("./consumer.mjs");
for (let i = 0; i < 50; i++) drainMicrotasks();
console.log("jobs loads");
