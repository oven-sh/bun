// Env: NODE_USE_ENV_PROXY=1
// Env: HTTP_PROXY=http://127.0.0.1:1
// With the proxy of the environment on, the agent parses what the environment held when node:http was loaded.
const http = require("node:http");
process.env.HTTP_PROXY = "http://127.0.0.1:2";
const { globalAgent } = http;
console.log(globalAgent.options.proxyEnv === process.env);
const request = http.get({ host: "example.invalid", path: "/" });
request.on("error", error => console.log(error.code, error.port));
