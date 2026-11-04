// One shape: the name of an exported function declaration is assigned in its own module by a call of an importer: a bigint. The importer reads the binding, and so does the module.
import { h, store, readThere } from "./other.mjs";
const show = v => typeof v === "function" ? "function " + v.name + " " + v() : typeof v === "symbol" ? "symbol" : typeof v === "bigint" ? v + "n" : typeof v === "object" ? JSON.stringify(v) : typeof v + " " + String(v);
const said = [];
function read() { return h; }
said.push(show(read()), show(readThere()), typeof h);
store();
said.push(show(read()), show(readThere()), typeof h, Object.is(read(), readThere()));
console.log(said.join(" | "));
