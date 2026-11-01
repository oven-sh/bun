// The first read of the variable is a read whose value nothing takes.
// Alone: what is put off goes by all that the executable holds
import { touch, read } from "./m.mjs";
try { console.log(touch()); } catch (e) { console.log(e.name + ": " + e.message); }
console.log(read().title.text, read() === read());
