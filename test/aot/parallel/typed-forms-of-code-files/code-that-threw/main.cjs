let thrown = "nothing";
try { require("./part.cjs"); } catch (error) { thrown = error.message; }
const text = require("./part.cjs", { type: "text" });
let again = "nothing";
try { require("./part.cjs"); } catch (error) { again = error.message; }
console.log(thrown, again, globalThis.ran, typeof text.default);
