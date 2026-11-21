// node:http reads the environment while it loads, at the link: a Proxy that the body lays over process.env sees no read when the import is first read.
import http from "node:http";
const reads = [];
const environment = process.env;
process.env = new Proxy(environment, {
  get(target, key) {
    reads.push(String(key));
    return target[key];
  },
});
console.log(typeof http.globalAgent, typeof http.createServer, reads.join(", ") || "no read");
console.log(typeof process.env.NODE_USE_ENV_PROXY, reads.join(", "));
