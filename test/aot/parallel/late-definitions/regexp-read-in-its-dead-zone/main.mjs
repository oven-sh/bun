// A read that comes before the declaration has run finds the dead zone, or undefined, and not the object that is made late.
const say = run => { try { console.log(run()); } catch (e) { console.log(e.name + ": " + e.message); } };
import { read, early, peek } from "./m.mjs";
say(() => [early, peek(), read().source].join());
