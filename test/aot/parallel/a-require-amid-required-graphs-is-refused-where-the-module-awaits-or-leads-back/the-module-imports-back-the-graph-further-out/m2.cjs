globalThis.L ??= (process.on("exit", code => console.log("ORDER " + globalThis.L.join(" ") + " | exit " + code)), []);
globalThis.D ??= ns => Object.keys(ns).filter(k => k !== "default" && k !== "module.exports" && k !== "__esModule").sort().map(k => { try { return k + "=" + String(ns[k]); } catch (e) { return k + "=!" + e.name; } }).join();
L.push("<m2");
let r3; try { r3 = require("./m3.mjs"); } catch (e) { console.log("m2 CAUGHT " + (e.code ?? e.name)); }
exports.t2 = "m2";
L.push("m2>");
