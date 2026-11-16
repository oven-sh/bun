// Under: --sourcemap=external: agent-base asks the stack whether node:https is below it
// Under: --obfuscate: the same
const http = require("node:http");
const https = require("node:https");

const isSecure = () => new Error().stack.split("\n").some(line => line.indexOf("(https.js:") !== -1 || line.indexOf("node:https:") !== -1);

class Agent extends http.Agent {
  addRequest(request) {
    console.log(request.constructor.name, isSecure());
    request.destroy();
  }
}
for (const [name, module, protocol] of [["http", http, "http:"], ["https", https, "https:"]]) {
  const agent = new Agent();
  agent.defaultPort = 443;
  agent.protocol = protocol;
  for (const ask of ["request", "get"]) {
    const request = module[ask]({ host: "127.0.0.1", port: 1, agent });
    request.on("error", () => {});
    request.destroy();
    console.log(name, ask);
  }
}
