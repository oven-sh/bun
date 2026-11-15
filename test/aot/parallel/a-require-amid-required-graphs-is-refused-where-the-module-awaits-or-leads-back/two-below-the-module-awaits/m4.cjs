globalThis.L ??= (process.on("exit", code => console.log("ORDER " + globalThis.L.join(" ") + " | exit " + code)), []);
globalThis.D ??= ns => Object.keys(ns).filter(k => k !== "default" && k !== "module.exports" && k !== "__esModule").sort().map(k => { try { return k + "=" + String(ns[k]); } catch (e) { return k + "=!" + e.name; } }).join();
L.push("<m4");
let got;
try { got = "ns(" + D(require("./m5.mjs")) + ")"; } catch (e) { got = "THROWN(" + (e.code ?? e.name) + ":" + String(e.message).replace(/"[^"]*"/g, "..").slice(0, 34) + ")"; }
console.log("GOT " + got);
exports.t4 = "m4";
L.push("m4>");
