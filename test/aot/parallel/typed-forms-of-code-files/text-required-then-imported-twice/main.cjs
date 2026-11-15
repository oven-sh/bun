const show = value => String(JSON.stringify(value)).slice(0, 34);
const first = require("./part.cjs", { type: "text" });
Promise.all([import("./part.cjs"), import("./part.cjs")]).then(([second, third]) => {
  console.log("ran", globalThis.ran ?? 0, first === second, second === third, require("./part.cjs") === first);
});
