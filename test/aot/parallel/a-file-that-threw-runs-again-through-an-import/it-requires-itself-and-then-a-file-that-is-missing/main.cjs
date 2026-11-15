try { require("./piece.cjs"); } catch {}
import("./piece.cjs").then(() => console.log("loaded"), e => console.log("rejected", e.name));
console.log("main ends");
function unused() { var prototype = Function.prototype; return "nothing" in Bun; }
