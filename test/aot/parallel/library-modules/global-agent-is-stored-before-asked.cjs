// A store before the first read: both modules hold what was stored.
const agents = require("node:_http_agent");
const http = require("node:http");
const mine = new http.Agent();
agents.globalAgent = mine;
console.log(http.globalAgent === mine, agents.globalAgent === mine);
