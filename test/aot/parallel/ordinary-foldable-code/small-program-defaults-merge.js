const DEFAULTS = { host: "localhost", port: 8080, tls: false, retries: 3, headers: { accept: "*/*" } };
const OVERRIDES = { port: 9090, tls: true, headers: { "x-id": "1" } };
const config = { ...DEFAULTS, ...OVERRIDES, headers: { ...DEFAULTS.headers, ...OVERRIDES.headers } };
const url = `${config.tls ? "https" : "http"}://${config.host}:${config.port}`;
console.log(config, url);
