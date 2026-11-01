// `new` by a function or a class whose object a variable of the file holds. Only a constructor that stores nothing on `this` is put off. A setter, a read-only value or a frozen prototype
// that the program lays above the object before the first read of the variable catches no store that ran where the declaration stands.
// Alone: what is put off, and what is found constant, goes by all that the executable holds
const say = run => { try { console.log(run()); } catch (e) { console.log(e.name + ": " + e.message); } };
import { read, K } from "./m.mjs";
Object.defineProperty(K.prototype, "x", { value: "above", writable: false, configurable: true });
say(() => { const o = read(); return [String(o.x), String(o.y), Object.keys(o).join("/"), o instanceof K].join(" "); });
