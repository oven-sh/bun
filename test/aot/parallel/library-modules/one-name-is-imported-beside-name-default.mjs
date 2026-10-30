// .. through the name `default`.
import { createServer, default as http } from "node:http";
const show = m => console.log(typeof m.request, typeof m.get, m.METHODS.length > 10, new m.Agent({ keepAlive: true }).keepAlive, typeof new m.ClientRequest("http://127.0.0.1:1/").on("error", () => {}).abort);
show(http);
console.log(typeof createServer);
