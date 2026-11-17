// `inline` and `init` mean something behind the path of an asset alone, and a suffix is a whole parameter in small letters.
// RUN: link
// CHECK-COUNT-6: module {{*}}path="/$bunfs/root/job.mjs?
// CHECK-NOT: module {{*}}path="/$bunfs/root/job.mjs?

// FILE: main.mjs
console.log(await import("./job.mjs?workers"), await import("./job.mjs?worker=1"), await import("./job.mjs?WORKER"));
console.log(await import("./job.mjs?sharedworkers"), await import("./job.mjs?init"), await import("./job.mjs?inline"));

// FILE: job.mjs
export const mark = 1;
