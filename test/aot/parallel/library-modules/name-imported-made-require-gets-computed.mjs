// .. through a require made by createRequire, under a computed name.
import { createServer } from "node:http";
import { createRequire } from "node:module";
const show = m => console.log(typeof m.request, typeof m.get, m.METHODS.length > 10, new m.Agent({ keepAlive: true }).keepAlive, typeof new m.ClientRequest("http://127.0.0.1:1/").on("error", () => {}).abort);
show(createRequire(import.meta.url)("node:" + (process.argv.length > 99 ? "x" : "http")));
console.log(typeof createServer);
