// What the initializer reads is not the same at all times. The variable holds what was there where the declaration stands.
// Alone: what is put off goes by all that the executable holds
import { read, loadedAt } from "./m.mjs";
const until = Date.now() + 40; while (Date.now() < until);
console.log(read().at - loadedAt < 25, read().r === read().r);
