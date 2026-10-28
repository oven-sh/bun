// A CommonJS file requires an ES module that imports the file. import() of the file settles in the same turn whether the text names the file or puts its name together.
let turns = Promise.resolve();
for (let turn = 1; turn <= 20; turn++) turns = turns.then(() => console.log(turn));
await import(["./file", "cjs"].join("."));
console.log("the computed name has settled");
await import("./other.cjs");
console.log("the written name has settled");
await import(["./plain", "cjs"].join("."));
console.log("a file that requires nothing has settled");
