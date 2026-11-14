// What a request has of its own when the listener is handed it, in the order in which it was laid: names and symbols, with and without a body.
import http from "node:http";

const shown = key => (typeof key === "symbol" ? "@" + key.description : key);
const server = http.createServer((req, res) => {
  console.log(req.method, req.url, Reflect.ownKeys(req).map(shown).join(" "));
  for (const key of Reflect.ownKeys(req)) {
    const { value, writable, enumerable, configurable } = Object.getOwnPropertyDescriptor(req, key);
    const kind = value === null ? "null" : Array.isArray(value) ? "list of " + value.length : typeof value === "object" ? "object" : typeof value === "function" ? "function" : String(value);
    console.log(" ", shown(key), kind, writable, enumerable, configurable);
  }
  req.resume();
  req.on("end", () => res.end("ok"));
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const url = `http://127.0.0.1:${server.address().port}`;
await (await fetch(url + "/without")).text();
await (await fetch(url + "/with", { method: "POST", body: "text" })).text();
server.close();
