// The rest of a module of which one name is imported, found through the loader taken as a value.
// Alone: TODO: with it among the entry points the executable is not built at the first try
import { createServer } from "node:http";
const show = m => console.log(typeof m.request, typeof m.get, m.METHODS.length > 10, new m.Agent({ keepAlive: true }).keepAlive, typeof new m.ClientRequest("http://127.0.0.1:1/").on("error", () => {}).abort);
const load = process.getBuiltinModule;
show(load("node:" + (process.argv.length > 99 ? "x" : "http")));
console.log(typeof createServer);
