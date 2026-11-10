// DECLARED: docs/compiler/compatibility.mdx, "Smaller differences". A stand-in laid under the private symbol `handle` of a response does something to the list of headers that it is handed.
// `bun <file>` renders every response into one list for the process: behind freeze() the next res.end() throws a TypeError, behind preventExtensions() every later one with a header does.
// An executable hands out a list for each response, and one empty list where there are no headers, as long as nothing has been put into it. A later response goes out with its own headers and no others.
// What writes into the list comes first: behind freeze() a list that is handed out whatever it holds could take nothing more, and the rows on the wire would say nothing.
const http = require("node:http");
const net = require("node:net");

const deeds = {
  push: list => list.push("x-made-up", "1"),
  define: list => Object.defineProperty(list, 0, { get: () => "x-made-up", configurable: false }),
  fixLength: list => Object.defineProperty(list, "length", { writable: false }),
  preventExtensions: list => Object.preventExtensions(list),
  seal: list => Object.seal(list),
  freeze: list => Object.freeze(list),
};

function ask(port) {
  return new Promise(resolve => {
    let heard = "";
    const client = net.connect(port, "127.0.0.1", () =>
      client.write("GET / HTTP/1.1\r\nHost: a\r\nConnection: close\r\n\r\n"),
    );
    client.on("data", chunk => (heard += chunk));
    client.on("error", () => {});
    client.on("close", () => resolve(heard));
  });
}

function namesIn(heard) {
  const names = heard
    .split("\r\n\r\n")[0]
    .split("\r\n")
    .slice(1)
    .map(line => line.split(":")[0].toLowerCase())
    .filter(name => name.startsWith("x-"));
  return names.length ? names.join("+") : "none";
}

function lay(res, count) {
  for (let i = 0; i < count; i++) res.setHeader(`x-name-${i}`, `value ${i}`);
}

async function row(name, first) {
  const counts = [first, 0, 2, 0];
  const said = [];
  let saw = "never asked";
  let turn = 0;
  const server = http.createServer((req, res) => {
    lay(res, counts[turn]);
    if (turn++ === 0) {
      const symbol = Object.getOwnPropertySymbols(res).find(it => it.description === "handle");
      const real = res[symbol];
      res[symbol] = {
        get flags() {
          return real.flags;
        },
        get finished() {
          return real.finished;
        },
        get bufferedAmount() {
          return real.bufferedAmount;
        },
        writeWholeResponse() {
          return undefined;
        },
        writeHeadAndEnd(status, message, list, ...rest) {
          saw = `${Object.isFrozen(list) ? "frozen" : "open"}, ${list.length}`;
          const before = [...list];
          try {
            deeds[name](list);
            saw += ", done";
          } catch (error) {
            saw += `, ${error.constructor.name}`;
          }
          return real.writeHeadAndEnd(status, message, before, ...rest);
        },
      };
    }
    try {
      res.end("ok");
      said.push("ended");
    } catch (error) {
      said.push(error.constructor.name);
      req.socket.destroy();
    }
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const heard = [];
  for (let i = 0; i < counts.length; i++) heard.push(namesIn(await ask(server.address().port)));
  await new Promise(resolve => server.close(resolve));
  console.log(`${name} | ${first} headers | ${saw} | ${said.join()} | ${heard.join(" . ")}`);
}

(async () => {
  for (const name of Object.keys(deeds)) for (const first of [0, 2]) await row(name, first);
})();
/* Output:
push | 0 headers | open, 0, done | ended,ended,ended,ended | none . none . x-name-0+x-name-1 . none
push | 2 headers | open, 4, done | ended,ended,ended,ended | x-name-0+x-name-1 . none . x-name-0+x-name-1 . none
define | 0 headers | open, 0, done | ended,ended,ended,ended | none . none . x-name-0+x-name-1 . none
define | 2 headers | open, 4, done | ended,ended,ended,ended | x-name-0+x-name-1 . none . x-name-0+x-name-1 . none
fixLength | 0 headers | open, 0, done | ended,ended,ended,ended | none . none . x-name-0+x-name-1 . none
fixLength | 2 headers | open, 4, done | ended,ended,ended,ended | x-name-0+x-name-1 . none . x-name-0+x-name-1 . none
preventExtensions | 0 headers | open, 0, done | ended,ended,ended,ended | none . none . x-name-0+x-name-1 . none
preventExtensions | 2 headers | open, 4, done | ended,ended,ended,ended | x-name-0+x-name-1 . none . x-name-0+x-name-1 . none
seal | 0 headers | open, 0, done | ended,ended,ended,ended | none . none . x-name-0+x-name-1 . none
seal | 2 headers | open, 4, done | ended,ended,ended,ended | x-name-0+x-name-1 . none . x-name-0+x-name-1 . none
freeze | 0 headers | open, 0, done | ended,ended,ended,ended | none . none . x-name-0+x-name-1 . none
freeze | 2 headers | open, 4, done | ended,ended,ended,ended | x-name-0+x-name-1 . none . x-name-0+x-name-1 . none
*/
