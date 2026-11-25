import("./part.cjs").then(async first => {
  const path = require("./part.cjs", { type: "file" });
  const second = await import("./part.cjs");
  console.log(typeof path, Object.keys(first).sort().join(), second === first, globalThis.ran ?? 0);
});
