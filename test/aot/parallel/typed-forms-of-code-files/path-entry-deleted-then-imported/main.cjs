const path = require("./part.cjs", { type: "file" });
require("./clear.cjs")(module);
import("./part.cjs").then(imported => {
  console.log(typeof path, Object.keys(imported).sort().join(), globalThis.ran ?? 0);
});
