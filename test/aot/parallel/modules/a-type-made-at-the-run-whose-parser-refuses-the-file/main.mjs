const made = globalThis.neverSet ? "text" : "toml";
const said = await import("./rows.json", { with: { type: made } }).then(
  typed => JSON.stringify(typed.default),
  error => error.name,
);
const plain = await import("./rows.json");
console.log(said, JSON.stringify(plain.default));
