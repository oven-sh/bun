interface Options { host?: string; port?: number }
function server(host: string, port: number) { return { host, port }; }
function start(opts: Options = {}) {
  Object.defineProperty(opts, "host", { value: "x" });
  const s = server(opts.host ?? "localhost", opts.port ?? 80);
  return JSON.stringify(s);
}
console.log(start());
