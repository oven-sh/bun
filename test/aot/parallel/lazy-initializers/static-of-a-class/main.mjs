// What the initializer reads is not the same at all times. The variable holds what was there where the declaration stands.
// Alone: what is put off goes by all that the executable holds
import { read } from "./m.mjs";
import { K } from "./k.mjs";
K.level = 2; K.prototype.v = 2;
console.log(JSON.stringify(read().seen));
