
const first = require("./u3-part.cjs", { type: "text" });
import("./u3-part.cjs").then(second => {
  console.log("ran", globalThis.ran ?? 0, first === second, String(JSON.stringify(second)).slice(0, 30));
});
