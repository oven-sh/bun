// A method that every request inherits is replaced on the prototype between the first request and the second, under a key that the text does not spell: the second request calls the new one.
// One name a process: what has been replaced once stays known as replaced. Hand the place of another name as the first argument.
import http from "node:http";
const names = ["emit", "_dump", "removeAllListeners", "resume", "read", "push", "destroy", "listenerCount", "_read", "_destroy"];
const key = names[Number(process.argv[2] ?? 1)], log = [];
function change() {
  let holder = http.IncomingMessage.prototype;
  while (!Object.hasOwn(holder, key)) holder = Object.getPrototypeOf(holder);
  const found = holder[key];
  http.IncomingMessage.prototype[key] = function (...rest) { log.push(key + ":" + (typeof rest[0] === "string" ? rest[0] : rest.length)); return found.apply(this, rest); };
}
let turn = 0;
const server = http.createServer((req, res) => { turn++; res.end("ok"); });
server.listen(0, async () => {
  for (let n = 0; n < 3; n++) {
    if (n === 1) change();
    const text = await (await fetch("http://127.0.0.1:" + server.address().port + "/")).text();
    await new Promise(done => setTimeout(done, 20));
    console.log(n, text, log.splice(0).join(" ") || "-");
  }
  server.closeAllConnections(); server.close();
});
