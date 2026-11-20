interface Options { host?: string; port?: number }
function server(host: string, port: number) { return { host, port }; }
function start(opts: Options = {}) {
  const s = server(opts.host ?? "localhost", opts.port ?? 80);
  const before = JSON.stringify(s);
  Object.defineProperty(s, "host", { enumerable: false });
  return before + " " + JSON.stringify(s);
}
console.log(start());
