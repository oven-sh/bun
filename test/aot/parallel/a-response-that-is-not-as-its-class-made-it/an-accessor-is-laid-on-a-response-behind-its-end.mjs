// end() has returned, and what finishes a response runs in a later tick. Before that tick the program lays an accessor over one name of the response. At its first read or store it throws, destroys the connection, ends once more or lays a listener. What is thrown, which events come and what the client gets are as without compilation.
import http from "node:http";
let row = null,
  line = "",
  keys = [];
const deeds = {
  "throws": () => {
    throw new Error("made up");
  },
  "destroys the connection": (req, res) => req.socket?.destroy(),
  "ends once more": (req, res) => res.end("x"),
  "lays a listener": (req, res) => res.on("close", () => (line += " . late listener")),
};
const text = key => (typeof key === "symbol" ? `[${key.description}]` : key);
process.on("uncaughtException", error => {
  line += ` . uncaught ${error.code ?? error.message}`;
});
const server = http.createServer((req, res) => {
  if (row === null) {
    const found = new Set(Reflect.ownKeys(res));
    res.on("close", () => {
      for (const key of Reflect.ownKeys(res)) found.add(key);
      keys = [...found];
    });
    res.end("keys");
    return;
  }
  const [key, deed, listens] = row;
  if (listens === "heard") for (const name of ["finish", "close"]) res.on(name, () => (line += ` . ${name}`));
  res.end("k");
  let value = res[key],
    acted = false;
  const act = () => {
    if (acted) return;
    acted = true;
    deeds[deed](req, res);
  };
  Object.defineProperty(res, key, {
    configurable: true,
    enumerable: true,
    get() {
      act();
      return value;
    },
    set(next) {
      value = next;
      act();
    },
  });
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const url = "http://127.0.0.1:" + server.address().port;
const guard = setTimeout(() => {
  console.log("did not end by itself");
  process.exit(1);
}, 80000);
await (await fetch(url)).text();
while (keys.length === 0) await new Promise(resolve => setImmediate(resolve));
let cases = 0;
for (const key of keys) {
  for (const deed of Object.keys(deeds)) {
    for (const listens of ["unheard", "heard"]) {
      row = [key, deed, listens];
      line = "";
      let seen = "no body";
      try {
        seen = JSON.stringify(await (await fetch(url, { signal: AbortSignal.timeout(3000) })).text());
      } catch {}
      for (let turn = 0; turn < 4; turn++) await new Promise(resolve => setImmediate(resolve));
      console.log(`${text(key)} . ${deed} . ${listens}: ${seen}${line}`);
      cases++;
    }
  }
}
clearTimeout(guard);
server.closeAllConnections();
await new Promise(resolve => server.close(resolve));
console.log(`${keys.length} names, ${cases} cases`);
