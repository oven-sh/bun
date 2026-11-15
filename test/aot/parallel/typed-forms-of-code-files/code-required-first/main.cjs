const code = require("./part.cjs");
const text = require("./part.cjs", { type: "text" });
console.log(code === text, require("./part.cjs") === code, globalThis.ran);
import("./part.cjs", { with: { type: "text" } }).then(imported => {
  console.log(typeof imported.default, require("./part.cjs") === code, globalThis.ran);
});
