// a-getter-under-one-private-name-asks-under-another.mjs
import http from "node:http";
let pending,
  lenient,
  headers,
  log = [],
  same = [],
  seen = [],
  asked = 0;
const server = http.createServer((req, res) => {
  if (pending === undefined) {
    const symbols = Object.getOwnPropertySymbols(res),
      find = description => symbols.find(symbol => symbol.description === description);
    pending = find("pendingCallbacks");
    lenient = find("kLenientValidation");
    headers = find("kOutHeaders");
    return res.end(String(Boolean(pending && lenient && headers)));
  }
  let first, inside;
  Object.defineProperty(res, lenient, {
    configurable: true,
    get() {
      if (first === undefined) {
        first = this[pending];
        inside = this[headers];
        if (++asked === 1) first.push(() => log.push("called"));
      }
      return false;
    },
  });
  res._isLenientHeaderValidation();
  same.push(first === res[pending], inside === res[headers]);
  seen.push(res[pending].length);
  res.end("k");
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const url = "http://127.0.0.1:" + server.address().port,
  bodies = [];
for (let i = 0; i < 4; i++) bodies.push(await (await fetch(url)).text());
console.log(bodies.join(), same.join(), seen.join(), log.join());
server.closeAllConnections();
await new Promise(resolve => server.close(resolve));
