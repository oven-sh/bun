// .. through another file of the program that imports the namespace.
import { createServer } from "node:http";
import { http } from "./whole/namespace.mjs";
const show = m => console.log(typeof m.request, typeof m.get, m.METHODS.length > 10, new m.Agent({ keepAlive: true }).keepAlive, typeof new m.ClientRequest("http://127.0.0.1:1/").on("error", () => {}).abort);
show(http);
console.log(typeof createServer);
