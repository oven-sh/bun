// An import() that has not settled gives nothing to a require() under another type: each loads its own.
const table = import("./casks.toml", { with: { type: "toml" } });
const place = require("./casks.toml", { type: "file" });
const kept = import("./vats.json", { with: { type: "file" } });
const words = require("./vats.json", { type: "text" });
(async () => {
  console.log(typeof place, place?.endsWith?.(".toml"), (await table).hoops);
  console.log(typeof words.default, words.default.length, (await kept).default.endsWith(".json"));
})();
