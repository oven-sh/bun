// What reflection says of the members of node:_http_agent and node:http.
const util = require("node:util");
for (const name of ["node:_http_agent", "node:http", "node:https"]) {
  const module = require(name);
  const found = Object.getOwnPropertyDescriptor(module, "globalAgent");
  console.log(name, Object.keys(found).join(), found.enumerable, found.configurable, typeof module.globalAgent);
}
const agents = require("node:_http_agent");
console.log(Object.keys(Object.getOwnPropertyDescriptors(agents).globalAgent).join());
console.log(util.inspect(agents, { depth: 0 }));
console.log(Object.getOwnPropertyDescriptor(agents, "globalAgent").value === require("node:http").globalAgent);
