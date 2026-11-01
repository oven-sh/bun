// A variable that is stored one constant is read as that constant, but for a read that comes before the store.
// Alone: what is put off, and what is found constant, goes by all that the executable holds
const say = run => { try { console.log(run()); } catch (e) { console.log(e.name + ": " + e.message); } };
import { x, again, other, read } from "./m.mjs";
again();
say(() => [x, read()].join());
other();
say(() => [x, read()].join());
