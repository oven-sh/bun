// TODO(bun): plain Bun has a value here. node:_http_agent is no public module, and node:http has an accessor there on both. Made at load the agent brings all of node:net, node:tls and node:dns to whoever loads node:http.
const agents = require("node:_http_agent");
const descriptor = Object.getOwnPropertyDescriptor(agents, "globalAgent");
console.log(Object.keys(descriptor).join(), descriptor.enumerable, descriptor.configurable);
/* Output:
get,set,enumerable,configurable true true
*/
