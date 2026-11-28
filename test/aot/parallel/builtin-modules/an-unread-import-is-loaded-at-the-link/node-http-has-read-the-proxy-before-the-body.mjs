// node:http reads the proxy of the environment at the link: what the body stores into the environment before it first reads the import comes too late for the global agent.
// Env: NODE_USE_ENV_PROXY=
import http from "node:http";
process.env.NODE_USE_ENV_PROXY = "1";
process.env.HTTP_PROXY = "not a url";
console.log("the body ran");
console.log(typeof http.globalAgent.options.proxyEnv);
