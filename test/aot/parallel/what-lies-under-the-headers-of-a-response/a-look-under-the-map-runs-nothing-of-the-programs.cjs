// A look under the symbol of a response's map of headers reads that one property. An accessor of the program's under another symbol of the response is not run by it.
const http = require("node:http");

let symbols;
const find = text => symbols.find(symbol => symbol.description === text);
const rows = [];
let turn = 0;

const ways = {
  "a header set and removed"(res) {
    res.setHeader("X-Made-Up", "1");
    res.removeHeader("X-Made-Up");
  },
  "a header set"(res) {
    res.setHeader("X-Made-Up", "1");
  },
  "no header"() {},
};

const server = http.createServer((req, res) => {
  if (turn++ === 0) {
    symbols = Object.getOwnPropertySymbols(res);
    return res.end("first");
  }
  const label = Object.keys(ways)[(turn - 2) % 3];
  const lenient = find("kLenientValidation");
  const headers = find("kOutHeaders");
  const pending = find("pendingCallbacks");
  let asked = 0;
  let thrown = "nothing";
  ways[label](res);
  const before = typeof res[lenient];
  Object.defineProperty(res, lenient, {
    configurable: true,
    get() {
      asked++;
      try {
        this[pending].push(() => {});
      } catch (error) {
        thrown = error.constructor.name;
      }
      return false;
    },
  });
  const first = res[headers];
  const second = res[headers];
  rows.push(`${label}: leniency ${before} . asked ${asked} . thrown ${thrown} . the map ${first === null ? "null" : Object.keys(first).join() || "empty"} . the same twice ${first === second}`);
  res.end("next");
});

server.listen(0, "127.0.0.1", async () => {
  const { port } = server.address();
  for (let i = 0; i < 7; i++) await (await fetch(`http://127.0.0.1:${port}/`)).text();
  console.log(rows.join("\n"));
  server.closeAllConnections();
  server.close();
});
