// require.resolve of a built-in module answers the name as it was asked: "fs" for "fs". Programs take `require.resolve(name) === name` for "this is a built-in module".
console.log("written:", require.resolve("fs"), require.resolve("node:fs"), require.resolve("path"), require.resolve("events"), require.resolve("bun:sqlite"), require.resolve("stream/promises"));
for (const name of ["fs", "node:fs", "path", "node:path", "events", "bun:sqlite", "stream/promises", "node:stream/promises"]) console.log(name, require.resolve(name), require.resolve(name) === name);
