// node:process, bun and node:module each mirror an object that exists without them. An export whose value Bun's own code would make is read off that object when somebody first asks for it:
// `await import("node:process")` makes no stream and no queue. From the first read on the export keeps its value, whatever the program then stores on the object.
// writes-to-host-objects/process-next-tick-* have the import with process.nextTick replaced, which throws if the import makes process.stdin.
const p = await import("node:process");
console.log(Object.keys(p).length > 50, p.default === process, p.env === process.env, typeof p.versions, "title" in p, p.nothing);
const before = p.config;
process.config = 1;
console.log("an export that was read keeps its value:", p.config === before, process.config);
process.features = 2;
console.log("an export that nobody had read gives what is there now:", p.features);
const b = await import("bun");
console.log(b.version === Bun.version, typeof b.file, b.argv === Bun.argv);
const m = await import("node:module");
console.log(typeof m.createRequire, typeof m.builtinModules);
