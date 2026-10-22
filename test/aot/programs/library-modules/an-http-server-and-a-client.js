// node:http on both sides: a server with routes, headers, a body that is read in pieces, a chunked answer and a 404; a client with request(), get(), an agent that keeps the connection, and an error for a closed port.
import http from "node:http";

const server = http.createServer((request, response) => {
  if (request.url === "/echo" && request.method === "POST") {
    const parts = [];
    request.on("data", part => parts.push(part));
    request.on("end", () => {
      response.writeHead(201, { "content-type": "text/plain", "x-length": String(Buffer.concat(parts).length) });
      response.end(Buffer.concat(parts).toString().toUpperCase());
    });
  } else if (request.url === "/chunks") {
    response.write("one,");
    response.write("two,");
    response.end("three");
  } else if (request.url === "/headers") {
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ custom: request.headers["x-custom"], method: request.method, version: request.httpVersion }));
  } else {
    response.statusCode = 404;
    response.end("nothing at " + request.url);
  }
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const { port } = server.address();
const agent = new http.Agent({ keepAlive: true, maxSockets: 1 });

function send(options, body) {
  return new Promise((resolve, reject) => {
    const request = http.request({ host: "127.0.0.1", port, agent, ...options }, response => {
      let text = "";
      response.setEncoding("utf8");
      response.on("data", part => (text += part));
      response.on("end", () => resolve([response.statusCode, response.statusMessage, response.headers["x-length"], response.headers["transfer-encoding"], text].join(" | ")));
    });
    request.on("error", reject);
    request.end(body);
  });
}

console.log(await send({ path: "/echo", method: "POST" }, "hello"));
console.log(await send({ path: "/chunks" }));
console.log(await send({ path: "/headers", headers: { "X-Custom": "yes" } }));
console.log(await send({ path: "/missing" }));
console.log(await new Promise(resolve => http.get({ host: "127.0.0.1", port, path: "/chunks" }, response => { response.resume(); response.on("end", () => resolve("get " + response.statusCode)); })));
agent.destroy();
await new Promise(resolve => server.close(resolve));
console.log(server.listening, await send({ path: "/", agent: false }).catch(error => error.code));
