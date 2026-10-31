import * as ws from "ws";
import { fetch } from "undici";
const listed = name =>
  [
    name in require.cache,
    Object.keys(require.cache).includes(name),
    Object.getOwnPropertyDescriptor(require.cache, name) !== undefined,
  ].join(" ");
console.log("ws:", typeof ws, listed("ws"));
console.log("undici:", typeof fetch, listed("undici"));
function inFunction(name) {
  return name in require.cache;
}
class Asks {
  field = "ws" in require.cache;
  method(name) {
    return name in require.cache;
  }
}
console.log(inFunction("ws"), new Asks().field, new Asks().method("undici"));
const names = [];
for (const name in require.cache) if (!name.startsWith("/")) names.push(name);
console.log(names.sort().join());
