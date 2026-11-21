// A path required under type "file" is what its CommonJS file exports from then on: an import() gets it as the default alone, and a require() without a type gets it too.
const path = require("./part.cjs", { type: "file" });
(async () => {
  const imported = await import("./part.cjs");
  console.log(typeof path, imported.default === path, Object.keys(imported).join(), "__esModule" in imported);
  const typed = await import("./part.cjs", { with: { type: "file" } });
  console.log(typeof typed.default, Object.keys(typed).sort().join());
  console.log(require("./part.cjs") === path);
})();
