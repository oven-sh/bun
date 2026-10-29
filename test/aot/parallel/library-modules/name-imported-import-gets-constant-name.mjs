// .. through import() of the constant name.
import { createServer } from "node:http";
const show = m => console.log(typeof m.request, typeof m.get, m.METHODS.length > 10, new m.Agent({ keepAlive: true }).keepAlive, typeof new m.ClientRequest("http://127.0.0.1:1/").on("error", () => {}).abort);
show(await import("node:http"));
console.log(typeof createServer);
