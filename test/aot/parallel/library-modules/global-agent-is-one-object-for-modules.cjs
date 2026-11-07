// The agent that requests use by default is one object for node:http and node:_http_agent. It can be replaced from either, and `undefined` stays once it is stored.
const http = require("node:http");
const agents = require("node:_http_agent");
console.log("names", Object.keys(agents).join());
console.log("one object", http.globalAgent === agents.globalAgent, http.globalAgent === http.globalAgent, http.globalAgent instanceof http.Agent);
console.log("its options", http.globalAgent.keepAlive, http.globalAgent.scheduling, http.globalAgent.options.timeout, http.globalAgent.maxSockets, http.globalAgent.proxyEnv);
const server = http.createServer((request, response) => response.end("hello " + request.url));
server.listen(0, () => {
  const { port } = server.address();
  http.get({ port, path: "/a" }, response => {
    let text = "";
    response.on("data", piece => (text += piece));
    response.on("end", () => {
      console.log("a request by default", response.statusCode, text, response.req.agent === http.globalAgent);
      const mine = new http.Agent({ keepAlive: false });
      http.globalAgent = mine;
      console.log("replaced through node:http", agents.globalAgent === mine);
      http.get({ port, path: "/b" }, second => {
        second.resume();
        second.on("end", () => {
          console.log("a request after that", second.statusCode, second.req.agent === mine);
          agents.globalAgent = undefined;
          console.log("undefined stays", http.globalAgent, agents.globalAgent);
          server.close();
          mine.destroy();
        });
      });
    });
  });
});
