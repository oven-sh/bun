import { kept } from "./keeps.mjs";
const attempt = (f) => { try { return f(); } catch (e) { return "threw " + e.name; } };
function read(K) { let t = 0; for (let i = 0; i < 300; i++) t += new K(i & 3).next(); return t; }
import("./lays.mjs").then(() => "loaded", (e) => "failed " + e.message).then((how) => { console.log(how, attempt(() => read(kept()))); });
