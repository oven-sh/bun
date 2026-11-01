// What the initializer reads is not the same at all times. The variable holds what was there where the declaration stands.
// Alone: what is put off goes by all that the executable holds
import { read } from "./m.mjs";
import { map } from "./map.mjs";
map.set("b", 2); map.set("a", 3);
console.log(JSON.stringify(read().seen));
