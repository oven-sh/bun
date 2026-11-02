const http = require("node:http");
const agentModule = require("node:_http_agent");
const util = require("node:util");
const { Agent } = http;
Agent.defaultMaxSockets = 7;
console.log(
  http.globalAgent.maxSockets,
  new Agent().maxSockets,
  http.globalAgent === agentModule.globalAgent,
  http.globalAgent instanceof Agent,
);
console.log(
  Object.keys(agentModule).join(),
  http.globalAgent.listenerCount("free"),
  http.globalAgent.eventNames().join(),
  http.globalAgent.keepAlive,
  http.globalAgent.options.timeout,
  http.globalAgent.scheduling,
);
console.log(util.inspect(http.globalAgent, { depth: 0 }).split("\n").length, Object.keys(http.globalAgent).join());
const mine = new Agent({ maxSockets: 2 });
http.globalAgent = mine;
console.log(http.globalAgent === mine, agentModule.globalAgent === mine);
agentModule.globalAgent = new Agent({ maxSockets: 3 });
console.log(http.globalAgent.maxSockets);
console.log(typeof require("node:https").globalAgent.maxSockets);
