import http, { Agent, globalAgent, createServer } from "node:http";
import * as star from "node:http";
class Mine extends Agent {
  on(t, f) {
    console.log("on", t);
    return super.on(t, f);
  }
  createConnection(...a) {
    console.log("connect");
    return super.createConnection(...a);
  }
}
const m = new Mine();
console.log(
  typeof createServer,
  m instanceof Agent,
  globalAgent === http.globalAgent,
  star.globalAgent === globalAgent,
  m.listenerCount("free"),
);
