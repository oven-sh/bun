const text = require("./shelf.mjs", { type: "text" });
const tell = (one, two) => Object.keys(one).join() + " " + String(two.boards) + " " + (one === two);
import("./shelf.mjs").then(async first => {
  const second = await import("./shelf.mjs");
  console.log(typeof text.default, first.default === text.default, tell(first, second), globalThis.built ?? 0);
});
