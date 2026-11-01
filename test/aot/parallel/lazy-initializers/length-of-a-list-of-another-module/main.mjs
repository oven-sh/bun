// What the initializer reads is not the same at all times. The variable holds what was there where the declaration stands.
// Alone: what is put off goes by all that the executable holds
import { read } from "./m.mjs";
import { list } from "./list.mjs";
list.push(9); list[0] = 7;
console.log(JSON.stringify(read().seen));
