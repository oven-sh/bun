import http from "node:http";
import https from "node:https";

const server = http.createServer((request, response) => response.end("answer to " + request.url));
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const { port } = server.address();

function get(path) {
  const { promise, resolve } = Promise.withResolvers();
  const request = http.get({ host: "127.0.0.1", port, path }, response => {
    let text = "";
    response.on("data", piece => (text += piece));
    response.on("end", () => resolve(text));
  });
  request.on("error", error => resolve("error: " + error.code));
  return promise;
}
function orNothing(promise) {
  const { promise: late, resolve } = Promise.withResolvers();
  const timer = setTimeout(resolve, 5000, "no answer");
  return Promise.race([promise, late]).finally(() => clearTimeout(timer));
}

const first = new Bun.ModuleGraph();
console.log("first:", await orNothing(first.run(get, "/first")));
first.dispose();

const second = new Bun.ModuleGraph();
console.log("second:", await orNothing(second.run(get, "/second")));
console.log("second again:", await orNothing(second.run(get, "/second-again")));
console.log("the host:", await orNothing(get("/host")));
second.dispose();
console.log("the host again:", await orNothing(get("/host-again")));

const third = new Bun.ModuleGraph();
console.log(
  "one agent for all:",
  third.run(() => http.globalAgent) === http.globalAgent,
  third.run(() => https.globalAgent) === https.globalAgent,
);
third.dispose();
http.globalAgent.destroy();
server.close();
