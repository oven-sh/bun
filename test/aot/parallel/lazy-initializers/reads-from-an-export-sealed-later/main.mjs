// An object that the initializer stores into, or reads from, is frozen, sealed or closed between the declaration and the first read of the variable.
// Alone: what is put off, and what is found constant, goes by all that the executable holds
const say = run => { try { console.log(run()); } catch (e) { console.log(e.name + ": " + e.message); } };
import { read } from "./m.mjs";
import { cfg } from "./cfg.mjs";
Object.seal(cfg);
say(() => [read().title, read().deep, Object.isFrozen(cfg)].join(" "));
