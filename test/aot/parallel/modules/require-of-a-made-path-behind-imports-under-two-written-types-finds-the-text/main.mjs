// The twin of require-of-a-made-path-behind-an-import-without-a-type-of-a-file-written-under-types-alone: no import without a type runs, so the loader holds no such entry,
// and require() finds the text in front of the JSON, whichever was loaded first: the loader looks under its own types before it looks under `json`.
const seen = [];
const show = it => Object.keys(it).join() + " " + typeof it.default + " #" + (seen.includes(it) ? seen.indexOf(it) : seen.push(it) - 1);
// No arm of the path is written: a written one would bring the file into the executable under the bare path.
const path = JSON.parse(JSON.stringify("./d.json"));
console.log("json", show(await import("./d.json", { with: { type: "json" } })));
console.log("text", show(await import("./d.json", { with: { type: "text" } })));
console.log("require", show(require(path)));
