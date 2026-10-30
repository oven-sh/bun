// As reaction-registered-by-tick-after-imported-cjs, but import() loads the importer, and the second reaction begins a chain of jobs: the importer runs and the call settles behind the links behind which they do under plain Bun.
await new Promise(done => setImmediate(done));
console.log("main calls import()");
await import("./importer.mjs");
console.log("the call has settled");
