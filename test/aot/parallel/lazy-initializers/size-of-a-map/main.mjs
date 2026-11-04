// What the initializer reads is not the same at all times. The variable holds what was there where the declaration stands.
import { read } from "./m.mjs";
import { map } from "./map.mjs";
map.set("b", 2); map.set("a", 3);
console.log(JSON.stringify(read().seen));
