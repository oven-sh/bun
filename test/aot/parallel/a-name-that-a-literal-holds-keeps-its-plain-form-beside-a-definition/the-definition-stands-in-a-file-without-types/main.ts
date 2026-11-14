import { lock } from "./lock.js";
interface Options { host?: string; port?: number }
function server(host: string, port: number) { return { host, port }; }
function start(opts: Options = {}) {
  const s = server(opts.host ?? "localhost", opts.port ?? 80);
  lock(s);
  return JSON.stringify(s);
}
console.log(start());
