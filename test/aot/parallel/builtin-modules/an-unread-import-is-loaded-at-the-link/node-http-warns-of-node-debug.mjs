// node:http asks for its debug log while it loads, at the link: with NODE_DEBUG=http, an import that nothing reads brings the warning of that variable.
// Env: NODE_DEBUG=http
import http from "node:http";
console.log("the body ran");
