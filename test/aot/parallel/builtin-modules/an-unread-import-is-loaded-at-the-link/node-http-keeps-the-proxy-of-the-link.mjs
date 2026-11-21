// node:http reads the proxy of the environment at the link: the global agent holds the environment though the body deletes the variables before it first reads the import.
// Env: NODE_USE_ENV_PROXY=1
// Env: HTTP_PROXY=http://127.0.0.1:9
// Env: http_proxy=http://127.0.0.1:9
// Env: HTTPS_PROXY=http://127.0.0.1:9
// Env: https_proxy=http://127.0.0.1:9
import http from "node:http";
delete process.env.NODE_USE_ENV_PROXY;
delete process.env.HTTP_PROXY;
console.log("the body ran");
console.log(http.globalAgent.options.proxyEnv === process.env);
