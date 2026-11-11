// An accessor of the program on a name that end() reads between its two ticks puts a process.nextTick of the program's own in place: it is handed the ticks that it is handed without compilation.
import http from "node:http";
const original = process.nextTick;
const turn = () => new Promise(resolve => setImmediate(resolve));
let name = "", seen = [];
const server = http.createServer((req, res) => {
  const own = res[name];
  let isReplaced = false;
  Object.defineProperty(res, name, {
    configurable: true,
    get() {
      if (!isReplaced) {
        isReplaced = true;
        process.nextTick = function (callback, ...all) {
          seen.push(callback.name + " " + all.map(one => (one === res ? "res" : one === req ? "req" : typeof one)).join(","));
          return original.call(this, callback, ...all);
        };
      }
      return own;
    },
    set(value) {
      Object.defineProperty(res, name, { configurable: true, writable: true, value });
    },
  });
  res.end("ok");
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const url = "http://127.0.0.1:" + server.address().port;
name = "sendDate";
await (await fetch(url)).text();
await turn();
process.nextTick = original;
for (name of ["_callPendingCallbacks", "emit", "_events"]) {
  seen = [];
  const text = await (await fetch(url)).text();
  await turn();
  await turn();
  process.nextTick = original;
  console.log(name, text, "|", seen.filter(one => one.endsWith("res") || one.includes("res,")).join(" . "));
}
await new Promise(resolve => server.close(resolve));
