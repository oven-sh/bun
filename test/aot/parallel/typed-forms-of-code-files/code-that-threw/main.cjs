let thrown = "nothing";
try { require("./part.cjs"); } catch (error) { thrown = error.message; }
const text = require("./part.cjs", { type: "text" });
const again = require("./part.cjs");
console.log(thrown, globalThis.ran, again === text, typeof again.default);
