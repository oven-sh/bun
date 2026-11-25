import http from "node:http";
import { Readable } from "node:stream";
const unseen = new Function("value", "return value;");
const seen = [];
const original = process.nextTick;
function counted(callback, ...rest) { seen.push(typeof callback + ":" + rest.length); return original.call(process, callback, ...rest); }
function touch() {
  process.nextTick = counted;
}
function ask(port, path) { return fetch("http://127.0.0.1:" + port + path, { method: "POST", body: "made of " + path }).then(answer => answer.text()); }
function drain() { return new Promise(done => { const parts = []; Readable.from(["one", "two"]).on("data", part => parts.push(part)).on("end", () => done(parts.join("+"))); }); }
const server = http.createServer((request, response) => { let body = ""; request.on("data", part => { body += part; }); request.on("end", () => { response.end(unseen(body)); }); });
server.listen(0, async () => {
  const port = server.address().port;
  console.log(await ask(port, "/first"), await drain(), seen.length);
  touch();
  console.log(await ask(port, "/second"), await drain(), seen.length > 5, process.nextTick === original);
  process.nextTick = original;
  console.log(await ask(port, "/third"), await drain(), process.nextTick === original);
  server.close();
});
