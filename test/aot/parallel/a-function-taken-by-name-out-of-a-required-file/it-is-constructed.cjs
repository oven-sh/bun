const { Agent } = require("node:_http_agent");
function makes(sockets) {
  return new Agent({ maxSockets: sockets });
}
console.log(new Function("a", "return a + 1")(1));
const made = makes(3);
console.log(made.maxSockets, made instanceof Agent, Object.getPrototypeOf(made) === Agent.prototype, made.constructor === Agent, makes(5).maxSockets);
