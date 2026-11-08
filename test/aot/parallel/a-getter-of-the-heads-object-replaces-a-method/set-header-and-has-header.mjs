// writeHead(200, { get "x-made-up"() { .. } , "content-type": .. }): the getter lays a setHeader() or a hasHeader() of the program's own on the response or on its prototype: the next header goes through the new one, and so do the questions behind the loop.
import http from "node:http";
const log = [];
let name = "", holder = "";
const server = http.createServer((req, res) => {
  if (name === "") return void res.end("first");
  const where = holder === "the response" ? res : http.ServerResponse.prototype;
  const hadOwn = Object.hasOwn(where, name);
  const original = where[name];
  res.writeHead(200, {
    get "x-made-up"() {
      where[name] = function (...values) {
        log.push(`${holder} ${name}(${values.join(", ")})`);
        return original.apply(this, values);
      };
      return "1";
    },
    "content-type": "text/plain",
    "x-last": "2",
  });
  res.end("ok");
  if (hadOwn) where[name] = original;
  else delete where[name];
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const url = "http://127.0.0.1:" + server.address().port;
await (await fetch(url)).text();
for (name of ["setHeader", "hasHeader"]) {
  for (holder of ["the response", "the prototype"]) {
    const answer = await fetch(url);
    log.push(`${holder} ${name}: ${answer.status} ${answer.headers.get("x-made-up")} ${answer.headers.get("content-type")} ${answer.headers.get("x-last")} ${await answer.text()}`);
  }
}
await new Promise(resolve => server.close(resolve));
console.log(log.join("\n"));
