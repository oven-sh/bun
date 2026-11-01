// What the initializer reads is not the same at all times. The variable holds what was there where the declaration stands.
// Alone: what is put off goes by all that the executable holds
import { read } from "./m.mjs";
import { cfg } from "./cfg.mjs";
cfg.late = 1; Object.freeze(cfg);
console.log(JSON.stringify(read().seen));
