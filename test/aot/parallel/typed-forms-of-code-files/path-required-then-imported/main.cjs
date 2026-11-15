const path = require("./part.cjs", { type: "file" });
import("./part.cjs").then(async first => {
  const second = await import("./part.cjs");
  console.log(typeof path, first.default === path, second === first, require("./part.cjs") === path, globalThis.ran ?? 0);
});
