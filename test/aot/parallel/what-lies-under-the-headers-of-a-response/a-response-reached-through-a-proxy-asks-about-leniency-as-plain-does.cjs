// The methods of a response are called through a Proxy or an heir. An accessor of the program's under the symbol of the cached leniency counts how often it is read: only a method that looks at a value reads it.
const http = require("node:http");

let symbols;
const rows = [];
let turn = 0;

const stands = {
  "a Proxy": res => new Proxy(res, {}),
  "an heir": res => Object.create(res),
};
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
const cases = Object.keys(stands).flatMap(stand => Object.keys(ways).map(way => [stand, way]));

const server = http.createServer((req, res) => {
  if (turn++ === 0) {
    symbols = Object.getOwnPropertySymbols(res);
    return res.end("first");
  }
  const [stand, way] = cases[(turn - 2) % cases.length];
  const lenient = symbols.find(symbol => symbol.description === "kLenientValidation");
  ways[way](res);
  let asked = 0;
  Object.defineProperty(res, lenient, {
    configurable: true,
    get() {
      asked++;
      return false;
    },
    set() {},
  });
  const other = stands[stand](res);
  const counts = [];
  const count = act => {
    const before = asked;
    let said;
    try {
      said = String(act());
    } catch (error) {
      said = error.constructor.name;
    }
    counts.push(`${said}/${asked > before}`);
  };
  count(() => other.hasHeader("x-made-up"));
  count(() => other.getHeader("x-made-up"));
  count(() => other.getHeaderNames().join());
  count(() => other.removeHeader("x-other"));
  count(() => other.hasHeader("x-made-up"));
  rows.push(`${stand} . ${way}: ${counts.join(" ")}`);
  res.end("next");
});

server.listen(0, "127.0.0.1", async () => {
  const { port } = server.address();
  for (let i = 0; i <= cases.length; i++) await (await fetch(`http://127.0.0.1:${port}/`)).text();
  console.log(rows.join("\n"));
  server.closeAllConnections();
  server.close();
});
