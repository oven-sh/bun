// node:http reads the proxy of the environment while it loads, at the link: with a proxy that is no URL, an import that nothing reads ends the program before its body.
// Env: NODE_USE_ENV_PROXY=1
// Env: HTTP_PROXY=not a url
// Env: http_proxy=not a url
// Exit code: 1
import http from "node:http";
console.log("the body ran");
