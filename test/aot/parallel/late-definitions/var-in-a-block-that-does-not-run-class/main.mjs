// The one store of the variable may never run. Then the variable holds nothing, and no object appears at its first read.
// Alone: what is put off, and what is found constant, goes by all that the executable holds
const say = run => { try { console.log(run()); } catch (e) { console.log(e.name + ": " + e.message); } };
import { read } from "./m.mjs";
say(() => typeof read());
