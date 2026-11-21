// An import() without a type of data that require() loaded as text gets the text, and the namespace carries the mark of a required module.
const json = require("./rows.json", { type: "text" });
const toml = require("./rack.toml", { type: "text" });
(async () => {
  for (const [text, imported] of [[json, await import("./rows.json")], [toml, await import("./rack.toml")]])
    console.log(typeof imported.default, imported.default === text, Object.keys(imported).sort().join(), imported.__esModule);
})();
