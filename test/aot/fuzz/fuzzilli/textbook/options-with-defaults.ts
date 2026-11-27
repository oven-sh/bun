interface Options {
  host?: string;
  port?: number;
}
function start(options: Options = {}) {
  const settled = { host: options.host ?? "localhost", port: options.port ?? 80 };
  console.log(JSON.stringify(settled));
  return settled.host + ":" + settled.port;
}
console.log(start(), start({ port: 8080 }));
