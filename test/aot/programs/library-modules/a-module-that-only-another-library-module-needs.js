// The program names node:http alone and starts a server, which needs node:net, node:events and node:stream. They are in the executable for that reason, so a computed name finds them. node:repl is needed by none of them.
import http from "node:http";

const server = http.createServer((request, response) => response.end("ok"));
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
console.log(await (await fetch("http://127.0.0.1:" + server.address().port)).text());
server.close();

for (const name of process.env.NAMES.split(",")) {
  try {
    console.log(name, typeof require(name));
  } catch (error) {
    console.log(name, error.code);
  }
}
