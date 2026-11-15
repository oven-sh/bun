globalThis.L ??= (process.on("exit", code => console.log("ORDER " + globalThis.L.join(" ") + " | exit " + code)), []);
globalThis.D ??= ns => Object.keys(ns).filter(k => k !== "default" && k !== "module.exports" && k !== "__esModule").sort().map(k => { try { return k + "=" + String(ns[k]); } catch (e) { return k + "=!" + e.name; } }).join();
import { load } from "./helper.cjs";
L.push("<inner");
load();
L.push("inner>");
