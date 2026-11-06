// .. through import() of a name that is put together at run time.
import { createServer } from "node:http";
const show = m => console.log(typeof m.request, typeof m.get, m.METHODS.length > 10, new m.Agent({ keepAlive: true }).keepAlive, typeof new m.ClientRequest("http://127.0.0.1:1/").on("error", () => {}).abort);
show(await import("node:" + (process.argv.length > 99 ? "x" : "http")));
console.log(typeof createServer);
