import { server } from "./maker.js";
interface Options { host?: string; port?: number }
function start(opts: Options = {}) {
  const s = server(opts.host ?? "localhost", opts.port ?? 80);
  Object.defineProperty(s, "host", { writable: false });
  return JSON.stringify(s);
}
console.log(start());
