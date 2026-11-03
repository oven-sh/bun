// `bun:fs` is read as `fs`, and require.resolve answers the name of a Node.js builtin as it is asked.
console.log(require.resolve("bun:fs"), require.resolve("bun:fs/promises"), require.resolve("bun:path"));
console.log(require.resolve("fs"), require.resolve("node:fs"), require.resolve("fs/promises"));
console.log(require("bun:fs") === require("fs"));
