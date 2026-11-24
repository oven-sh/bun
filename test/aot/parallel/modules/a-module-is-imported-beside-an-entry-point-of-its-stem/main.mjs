// part.js is the module that `import()` names. part.cjs, an entry point, is another file, and is found by its own name.
// Entry points: ./part.cjs ./lib/unit.ts
const part = await import("./part.js");
console.log(Object.keys(part).sort().join(" "), part.kind, JSON.stringify(part.default));
const unit = await import("./lib/unit.js");
console.log(Object.keys(unit).sort().join(" "), unit.kind);
const other = await import("./part.cjs");
console.log(other.kind, other.default.kind, other.default === part.default);
const typed = await import("./lib/unit.ts");
console.log(typed.kind, typed.more, typed === unit);
const again = await import(import.meta.resolve("./part.js"));
console.log(again === part, again.kind);
