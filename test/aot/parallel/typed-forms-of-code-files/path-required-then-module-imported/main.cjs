const path = require("./drawer.mjs", { type: "file" });
import("./drawer.mjs").then(async first => {
  const second = await import("./drawer.mjs");
  console.log(typeof path, Object.keys(first).join(), first.default === path, second === first, first.pull());
  console.log(require("./drawer.mjs") === path, require("./drawer.mjs", { type: "file" }) === path, globalThis.opened);
});
