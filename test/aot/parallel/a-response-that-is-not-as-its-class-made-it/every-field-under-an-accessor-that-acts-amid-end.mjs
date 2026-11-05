// Every own field of a response, one at a time, lies under an accessor of the program that gives and takes the value as a data property would, and that at its first read amid end() writes, ends, flushes or destroys. Three files beside this one run it for a first write(), a second write() and writeHead(). What the call does, what the client gets and what is thrown are as without compilation. How often a field is read is not printed. The same deeds in front of the call are the control.
import http from "node:http";
let row = null,
  line = "",
  keys = [];
let cases = 0;
const deeds = {
  "writes": (req, res) => res.write("x"),
  "ends": (req, res) => res.end("x"),
  "flushes": (req, res) => res.flushHeaders(),
  "destroys": (req, res) => res.destroy(),
  "destroys the connection": (req, res) => req.socket.destroy(),
};
const calls = {
  "end": res => (res.end("k"), "returns"),
  "first write": res => `gives ${res.write("k")}`,
  "second write": res => `gives ${res.write("k")}`,
  "writeHead": res => (res.writeHead(200, { "x-made-up": "1" }), "returns"),
};
const text = key => (typeof key === "symbol" ? `[${key.description}]` : key);
process.on("uncaughtException", error => {
  line += ` . uncaught ${error.code}`;
});
const server = http.createServer((req, res) => {
  if (row === null) {
    keys = Reflect.ownKeys(res);
    res.end("keys");
    return;
  }
  const [key, call, deed, framing] = row;
  if (framing === "a length") res.setHeader("Content-Length", call === "second write" ? "2" : "1");
  if (call === "second write") res.write("o");
  let amid = false;
  if (key !== undefined) {
    let value = res[key],
      acted = false;
    Object.defineProperty(res, key, {
      configurable: true,
      enumerable: true,
      get() {
        if (amid && !acted) {
          acted = true;
          deeds[deed](req, res);
        }
        return value;
      },
      set(next) {
        value = next;
      },
    });
  }
  try {
    if (key === undefined) deeds[deed](req, res);
    amid = true;
    line = calls[call](res);
  } catch (error) {
    line = `throws ${error.name} ${error.code}`;
  }
  amid = false;
  try {
    if (!res.writableEnded && !res.destroyed) res.end(call === "writeHead" && framing === "a length" ? "k" : undefined);
  } catch (error) {
    line += ` . then ${error.code}`;
    res.destroy();
  }
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const url = "http://127.0.0.1:" + server.address().port;
const guard = setTimeout(() => {
  console.log("did not end by itself");
  process.exit(1);
}, 80000);
await (await fetch(url)).text();
const call = process.env.CALL ?? "end";
for (const key of [undefined, ...keys]) {
  // Whether header values are checked leniently is asked once a message, and the answer reads `req`: at the first setHeader() without compilation, later with it. When a field is read is not what this file is about.
  if (key === "req" && call === "writeHead") continue;
  for (const deed of Object.keys(deeds)) {
    for (const framing of ["a length", "chunks"]) {
      row = [key, call, deed, framing];
      line = "";
      let seen = "no body";
      try {
        const answer = await fetch(url, { signal: AbortSignal.timeout(3000) });
        seen = `${answer.status} ${answer.headers.get("x-made-up")} ${JSON.stringify(await answer.text())}`;
      } catch {}
      await new Promise(resolve => setImmediate(resolve));
      const name = `${key === undefined ? "in front" : text(key)} . ${call} . ${deed} . ${framing}`;
      console.log(`${name}: ${line} . ${seen}`);
      cases++;
    }
  }
}
clearTimeout(guard);
server.closeAllConnections();
await new Promise(resolve => server.close(resolve));
console.log(`${keys.length} fields, ${cases} cases`);
