console.log("m3+");
Object.defineProperty(exports, "first", { enumerable: true, get() { console.log("m3?"); return "m3"; } });
try { require("./m6.mjs"); } catch (e) { console.log("m3 caught", e.name); }
console.log("m3-");
