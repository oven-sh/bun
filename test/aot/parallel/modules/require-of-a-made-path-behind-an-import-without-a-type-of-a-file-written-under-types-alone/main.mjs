// The program writes d.json under two types and names it without a type only by a path that the build does not know, so the executable holds no module under the bare path.
// Under `bun <file>` the import without a type leaves an entry of its own, and require() finds that one first. The executable answered the text, which was loaded first.
const seen = [];
const show = it => Object.keys(it).join() + " " + typeof it.default + " #" + (seen.includes(it) ? seen.indexOf(it) : seen.push(it) - 1);
// No arm of the path is written: a written one would bring the file into the executable under the bare path.
const path = JSON.parse(JSON.stringify("./d.json"));
console.log("text", show(await import("./d.json", { with: { type: "text" } })));
if (process.argv.length > 99) await import("./d.json", { with: { type: "json" } });
console.log("import", show(await import(path)));
console.log("require", show(require(path)));
