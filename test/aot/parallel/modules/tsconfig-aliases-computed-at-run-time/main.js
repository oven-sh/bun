// Entry points: ./aliased/job.ts ./aliased/folder/index.ts ./aliased/library.cjs ./aliased/module.mjs ./src/nested/task.ts ./inner/load.cjs ./inner/own/value.cjs
// Alone: a Worker's name is looked for from the folder in which the program is built
// A name that the program computes is mapped by "paths" and "baseUrl" of tsconfig.json to a file the executable holds.
const computed = text => Buffer.from(text).toString();
const start = name =>
  new Promise(done => {
    const worker = new Worker(computed(name));
    const end = text => (console.log(name + ": " + text), worker.terminate(), done());
    worker.onmessage = event => end(event.data);
    worker.onerror = event => (event.preventDefault(), end("error"));
  });
for (const name of ["@lib/job", "@lib/job.ts", "@lib/job.js", "@lib/folder", "@lib/folder/", "@lib/folder/index", "exact-job", "nested/task"]) await start(name);
console.log(require(computed("@lib/library")), require(computed("@lib/library.cjs")));
console.log((await import(computed("@lib/module"))).default, (await import(computed("@lib/module.mjs"))).default);
console.log(require(computed("./inner/load.cjs"))());
for (const name of ["@lib/missing", "@other/job"]) {
  try {
    require(computed(name));
  } catch (error) {
    console.log(name + ": " + error.code);
  }
}
