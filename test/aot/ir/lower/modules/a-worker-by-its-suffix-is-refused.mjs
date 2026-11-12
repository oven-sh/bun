// With `url` beside it, `worker` asks for the path of the file, as `url` alone does. The build holds no such path, and stops. A `require` has no further module of a file at all.
// RUN: lower
// DIAGNOSTIC: TS100159 main.mjs:1
// DIAGNOSTIC: TS100159 main.mjs:2
// DIAGNOSTIC: TS100159 main.mjs:3

// FILE: main.mjs
console.log(await import("./job.mjs?worker&url"));
console.log(await import("./job.mjs?url&sharedworker"));
console.log(import.meta.require("./job.mjs?worker"));

// FILE: job.mjs
export const mark = 1;
