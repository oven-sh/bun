interface Options { host?: string; port?: number }
function server(host: string, port: number) { return { host, port }; }
function never() { const t = server("a", 1); return { ...t }; }
function start(opts: Options = {}) {
  if (process.argv.length > 90) console.log(never());
  const s = server(opts.host ?? "localhost", opts.port ?? 80);
  Object.defineProperty(s, "host", { writable: false });
  return JSON.stringify(s);
}
console.log(start());
