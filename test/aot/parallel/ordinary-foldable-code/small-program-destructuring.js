const CONFIG = { server: { host: "0.0.0.0", ports: [80, 443] }, name: "svc" };
const {
  server: {
    host,
    ports: [http, https = 8443, extra = 9000],
  },
  name: service,
  missing = "fallback",
} = CONFIG;
console.log(host, http, https, extra, service, missing);
