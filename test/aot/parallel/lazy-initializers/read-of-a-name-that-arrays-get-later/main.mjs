// The initializer reads a name through the objects above a function or an array that it has made. Those objects get, lose or change the name later.
import { read } from "./m.mjs";
Array.prototype.extra = "late";
try { console.log(JSON.stringify(read().seen), typeof read().big); } catch (e) { console.log(e.name + ": " + e.message); }
