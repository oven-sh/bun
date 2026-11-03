// What Bun.serve refuses at each of its options, and what its messages say: none of them prints the value, so no code of the program runs for one.
let ran = 0;
const odd = Object.create(null);
odd[Symbol.for("nodejs.util.inspect.custom")] = () => {
  ran++;
  return "custom text";
};
const named = {
  constructor: {
    get name() {
      ran += 10;
      return "Named";
    },
  },
};
const fetch = () => new Response("x");
for (const value of [odd, named]) {
  for (const name of [
    "port",
    "hostname",
    "unix",
    "id",
    "baseURI",
    "routes",
    "static",
    "tls",
    "websocket",
    "fetch",
    "error",
    "idleTimeout",
    "maxRequestBodySize",
    "development",
    "reusePort",
    "http2",
  ]) {
    try {
      Bun.serve({ port: 0, fetch, [name]: value }).stop(true);
      console.log(name, "serves");
    } catch (error) {
      console.log(name, error.name, error.code, String(error.message).slice(0, 90).split("\n")[0]);
    }
  }
  for (const options of [
    { routes: { "/a": value } },
    { routes: { "/a": { GET: value } } },
    { routes: { "/a/*": { dir: value } } },
    { tls: { key: value } },
    { tls: [value] },
    { tls: { key: [value] } },
    { websocket: { message: value } },
    { websocket: { message() {}, idleTimeout: value } },
    { development: { hmr: value } },
  ]) {
    try {
      Bun.serve({ port: 0, fetch, ...options }).stop(true);
      console.log("serves");
    } catch (error) {
      console.log(error.name, error.code, String(error.message).slice(0, 90).split("\n")[0]);
    }
  }
}
try {
  Bun.serve({
    port: 0,
    fetch,
    tls: {
      key: {
        *[Symbol.iterator]() {
          ran += 100;
        },
      },
    },
  }).stop(true);
} catch {
  ran += 1000;
}
try {
  Bun.serve({
    port: 0,
    fetch,
    tls: [
      {
        key: {
          *[Symbol.iterator]() {
            ran += 10000;
          },
        },
        serverName: "a",
      },
    ],
  }).stop(true);
} catch {
  ran += 100000;
}
console.log(ran);
