// The one store of the variable may never run. Then the variable holds nothing, and no object appears at its first read.
const say = run => { try { console.log(run()); } catch (e) { console.log(e.name + ": " + e.message); } };
import { read, init } from "./m.mjs";
const early = typeof read();
init();
say(() => [early, typeof read(), read() === read()].join());
