import { nextTurns } from "../host.ts";
import * as classes from "./commonjs-classes/node.cjs";
class Server {
  normalize(request: classes.Plain | classes.Wrapped): classes.Wrapped {
    return !(request instanceof classes.Wrapped) ? new classes.Wrapped(request) : request;
  }
}
const server = new Server();
const plain: classes.Plain = { method: "get", url: "/", headers: {} };
function bench(n: number): number {
  let s = 0;
  for (let i = 0; i < n; i++) {
    const wrapped = server.normalize(plain);
    s += server.normalize(wrapped).streaming ? 1 : 2;
  }
  return s;
}
let check = 0;
for (let n = nextTurns(0); n > 0; n = nextTurns(check)) check += bench(n) & 1023;
console.log(check);
