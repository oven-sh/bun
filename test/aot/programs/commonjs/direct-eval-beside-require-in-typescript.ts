// A direct eval at the top level of a TypeScript file that calls `require`, and so runs as CommonJS, is handed the file's `this` without a TypeError.
try { console.log(eval("1 + 1")) } catch (e) { console.log(String(e)) }; console.log(typeof require("node:path").join)
