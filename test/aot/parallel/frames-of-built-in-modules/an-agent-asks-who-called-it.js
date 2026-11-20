// An agent of one's own asks which built-in module has called it: the frames of built-in modules bear their names.
// Under: --sourcemap=external: with a map beside the executable they bear the same names
// Under: --obfuscate: the same
const http = require("node:http");
const https = require("node:https");

function whoCalled() {
  let found = "nobody";
  for (const line of new Error("who").stack.split("\n").slice(1)) {
    const named = /node:(https?)\b/.exec(line);
    if (named) found = named[1] === "https" || found === "https" ? "https" : "http";
  }
  return found;
}

class Agent extends http.Agent {
  addRequest(request) {
    console.log(request.constructor.name, whoCalled());
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
