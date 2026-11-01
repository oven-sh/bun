// Nothing makes a request: the agent of node:http is not made, and Agent, node:tls and node:dns stay out.
// STATISTIC: ImageFunctionsEmitted <= 1300
const { createServer } = require("node:http");
console.log(typeof createServer);
