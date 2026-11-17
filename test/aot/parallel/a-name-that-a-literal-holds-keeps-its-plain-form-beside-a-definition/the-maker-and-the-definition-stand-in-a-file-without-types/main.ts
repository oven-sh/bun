import { server, lock } from "./lib.js";
interface Options { host?: string; port?: number }
function start(opts: Options = {}) {
  const s = server(opts.host ?? "localhost", opts.port ?? 80);
  lock(s);
  return JSON.stringify(s);
}
console.log(start());
