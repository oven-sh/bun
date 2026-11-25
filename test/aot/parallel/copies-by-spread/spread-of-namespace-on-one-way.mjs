import * as namespace from "./part-exports.mjs";
function copy(source) { return { ...source }; }
let held; if (process.argv.length < 90) held = namespace;
for (const name in copy(held)) console.log(name);
console.log(Object.keys({ before: 0, ...held, after: 9 }).join());
