// `bun run` loads a wrapper in place of the file: its default export starts the file on a thread of its own. The build writes that module, and follows the `new Worker` in it to the file, which is one more entry point.
// RUN: link
// CHECK: module [[wrapper]] path="/$bunfs/root/job.mjs?worker" displayPath="job.mjs"
// CHECK: module [[job]] path="/$bunfs/root/job.mjs" displayPath="job.mjs"
// CHECK: function {{*}}name="WorkerWrapper" module=[[wrapper]]
// CHECK: entry module=[[job]]

// FILE: main.mjs
console.log(await import("./job.mjs?worker"));

// FILE: job.mjs
postMessage("started");
