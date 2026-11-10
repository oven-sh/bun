(globalThis.objects ??= []).push(module);
const { createRequire } = require("node:module");
const made = createRequire(__filename); const { run } = require("./caller.cjs");
const first = run(made, "./a.cjs"); const second = run(made, "./a.cjs"); console.log("SAID same", first === second);
