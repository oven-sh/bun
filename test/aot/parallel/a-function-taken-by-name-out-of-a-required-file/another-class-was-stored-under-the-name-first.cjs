const stores = new Function("ask", "ask('node:_http_agent').Agent = class Other { constructor(options) { this.maxSockets = -options.maxSockets; } }; return 1");
console.log(stores(require));
const { Agent } = require("node:_http_agent");
function makes(sockets) {
  return new Agent({ maxSockets: sockets });
}
const made = makes(3);
console.log(made.maxSockets, made instanceof Agent, made.constructor.name, makes(5).maxSockets);
