interface Options { host?: string; port?: number }
function server(host: string, port: number) { return { host, port }; }
function start(opts: Options = {}) {
  const s = server(opts.host ?? "localhost", opts.port ?? 80);
  Object.defineProperties(s, { host: { value: () => "x" } });
  return Object.keys(s).join() + " " + typeof (s as any).host + " " + JSON.stringify(s);
}
console.log(start());
