import * as ns from "./barrel2.js";
const read = key => { try { return String(typeof ns[key] === "function" ? ns[key]() : ns[key]); } catch (error) { return "threw " + error.name; } };
export const seen = () => ["x", "y", "f", "extra", "side", "own", "second"].map(key => key + "=" + read(key)).join(" ") + " keys=" + Object.keys(ns).sort().join("+");
