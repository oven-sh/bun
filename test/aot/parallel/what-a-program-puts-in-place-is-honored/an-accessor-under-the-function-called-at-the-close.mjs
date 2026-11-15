// An accessor is laid at 'finish' under the private name of the function that is called at the close. How often it is read and stored is as without compilation.
import http from "node:http";
let line = [];
const server = http.createServer((req, res) => {
  const symbol = Object.getOwnPropertySymbols(res).find(found => found.description === "closeCallback");
  res.on("finish", () => {
    let value = res[symbol];
    Object.defineProperty(res, symbol, {
      configurable: true,
      enumerable: true,
      get() {
        line.push("get");
        return value;
      },
      set(next) {
        line.push("set " + typeof next);
        value = next;
      },
    });
  });
  setImmediate(() => res.end("k"));
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const body = await (await fetch("http://127.0.0.1:" + server.address().port)).text();
for (let i = 0; i < 4; i++) await new Promise(resolve => setImmediate(resolve));
console.log(body + " | " + line.join(" . "));
server.closeAllConnections();
await new Promise(resolve => server.close(resolve));
