globalThis.L ??= (process.on("exit", code => console.log("ORDER " + globalThis.L.join(" ") + " | exit " + code)), []);
globalThis.D ??= ns => Object.keys(ns).filter(k => k !== "default" && k !== "module.exports" && k !== "__esModule").sort().map(k => { try { return k + "=" + String(ns[k]); } catch (e) { return k + "=!" + e.name; } }).join();
L.push("<main");
let r1; try { r1 = require("./m1.mjs"); } catch (e) { console.log("main CAUGHT " + (e.code ?? e.name)); }
exports.tmain = "main";
L.push("main>");

/* Output:
GOT THROWN(TypeError:require() async module .. is unsup)
m2 CAUGHT TypeError
main CAUGHT TypeError
ORDER <main <m2 <m4 <leaf m4> m2> main> leaf> m3 m1 | exit 0
*/
