console.log("running begins");
const run = new Function("name", "url", "const promise = import(name); process.getBuiltinModule('module').createRequire(url)('bun:jsc').drainMicrotasks(); return promise;");
run(import.meta.resolve("./running.mjs"), import.meta.url).then(
  names => console.log("import of running: fulfilled, ended:", names.ended),
  error => console.log("import of running: rejected,", error.message),
);
console.log("running ends");
export const ended = true;
