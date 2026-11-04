// What the initializer reads is not the same at all times. The variable holds what was there where the declaration stands.
import { read, loadedAt } from "./m.mjs";
const until = Date.now() + 40; while (Date.now() < until);
console.log(read().at - loadedAt < 25, read().r === read().r);
