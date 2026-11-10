const held =
  typeof process.getBuiltinModule === "function"
    ? process.getBuiltinModule("module").createRequire(import.meta.url)
    : undefined;
const none = process.argv.length > 9 ? process.getBuiltinModule("module").createRequire(import.meta.url) : null;
let said;
try {
  said = none("./lib/index.cjs");
} catch (error) {
  said = error.name;
}
console.log("SAID", held("./lib/part.cjs"), none?.("./lib/index.cjs"), said);
