// A require() reads its type from a shorthand property as from `type: type`.
const part = (() => {
  const type = "text";
  return require("./part.cjs", { type });
})();
const path = (() => {
  let type = "file";
  return require("./notes.mjs", { type });
})();
const rows = ((type) => require("./rows.json", { type }))(undefined);
console.log(typeof part, typeof part === "object" ? Object.keys(part).join() : "", typeof path, JSON.stringify(rows), globalThis.ran ?? 0);
