const path = require("./note.cjs", { type: "file" });
import("./note.cjs").then(async first => {
  const second = await import("./note.cjs");
  console.log(typeof path, second === first, Object.keys(first).length, globalThis.noted ?? 0);
});
