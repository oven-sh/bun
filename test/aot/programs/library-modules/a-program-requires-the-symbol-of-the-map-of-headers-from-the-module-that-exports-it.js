// node:_http_outgoing exports the symbol under which a message keeps the map of its headers. A program takes it by require() and by process.getBuiltinModule(),
// and looks and stores under it on the response of a server. Each look has a request of its own, and the client says which headers came.
const http = require("node:http");
const { kOutHeaders } = require("node:_http_outgoing");
const outgoing = require("node:_http_outgoing");
const kept = require("_http_outgoing").kOutHeaders;
const { kOutHeaders: fromProcess } = process.getBuiltinModule("node:_http_outgoing");
const holder = { key: require("node:_http_outgoing").kOutHeaders };
function answered() {
  return require("node:_http_outgoing").kOutHeaders;
}
const lines = [];
const show = value => JSON.stringify(value) ?? "undefined";
const steps = {
  "/a-pattern/read": res => show(res[kOutHeaders]),
  "/a-pattern/read-in-a-chain": res => show(res?.[kOutHeaders]),
  "/a-pattern/a-pattern": res => (({ [kOutHeaders]: found }) => show(found))(res),
  "/a-pattern/in": res =>
    (kOutHeaders in res) + " " + Object.hasOwn(res, kOutHeaders) + " " + res.hasOwnProperty(kOutHeaders),
  "/a-pattern/a-descriptor": res => show(Object.getOwnPropertyDescriptor(res, kOutHeaders).value),
  "/a-pattern/Reflect.get": res => show(Reflect.get(res, kOutHeaders)) + " " + Reflect.has(res, kOutHeaders),
  "/a-pattern/change-what-is-read": res => ((res[kOutHeaders]["x-two"] = ["X-Two", "2"]), show(res.getHeaders())),
  "/a-pattern/store-a-map": res => (
    (res[kOutHeaders] = { __proto__: null, "x-two": ["X-Two", "2"] }),
    show(res.getHeaders())
  ),
  "/a-pattern/store-null": res => ((res[kOutHeaders] = null), show(res.getHeaders())),
  "/a-pattern/store-a-map-if-there-is-none": res => (
    (res[kOutHeaders] ??= { __proto__: null, "x-two": ["X-Two", "2"] }),
    show(res.getHeaders())
  ),
  "/a-pattern/Reflect.set": res =>
    Reflect.set(res, kOutHeaders, { __proto__: null, "x-two": ["X-Two", "2"] }) + " " + show(res.getHeaders()),
  "/a-pattern/define": res => (
    Object.defineProperty(res, kOutHeaders, {
      value: { __proto__: null, "x-two": ["X-Two", "2"] },
      writable: true,
      enumerable: true,
      configurable: true,
    }),
    show(res.getHeaders())
  ),
  "/a-pattern/store,-then-set-a-header": res => (
    (res[kOutHeaders] = { __proto__: null, "x-two": ["X-Two", "2"] }),
    res.setHeader("X-Three", "3"),
    show(res.getHeaders())
  ),
  "/a-member/read": res => show(res[outgoing.kOutHeaders]),
  "/a-member/read-in-a-chain": res => show(res?.[outgoing.kOutHeaders]),
  "/a-member/a-pattern": res => (({ [outgoing.kOutHeaders]: found }) => show(found))(res),
  "/a-member/in": res =>
    (outgoing.kOutHeaders in res) +
    " " +
    Object.hasOwn(res, outgoing.kOutHeaders) +
    " " +
    res.hasOwnProperty(outgoing.kOutHeaders),
  "/a-member/a-descriptor": res => show(Object.getOwnPropertyDescriptor(res, outgoing.kOutHeaders).value),
  "/a-member/Reflect.get": res =>
    show(Reflect.get(res, outgoing.kOutHeaders)) + " " + Reflect.has(res, outgoing.kOutHeaders),
  "/a-member/change-what-is-read": res => (
    (res[outgoing.kOutHeaders]["x-two"] = ["X-Two", "2"]),
    show(res.getHeaders())
  ),
  "/a-member/store-a-map": res => (
    (res[outgoing.kOutHeaders] = { __proto__: null, "x-two": ["X-Two", "2"] }),
    show(res.getHeaders())
  ),
  "/a-member/store-null": res => ((res[outgoing.kOutHeaders] = null), show(res.getHeaders())),
  "/a-member/store-a-map-if-there-is-none": res => (
    (res[outgoing.kOutHeaders] ??= { __proto__: null, "x-two": ["X-Two", "2"] }),
    show(res.getHeaders())
  ),
  "/a-member/Reflect.set": res =>
    Reflect.set(res, outgoing.kOutHeaders, { __proto__: null, "x-two": ["X-Two", "2"] }) + " " + show(res.getHeaders()),
  "/a-member/define": res => (
    Object.defineProperty(res, outgoing.kOutHeaders, {
      value: { __proto__: null, "x-two": ["X-Two", "2"] },
      writable: true,
      enumerable: true,
      configurable: true,
    }),
    show(res.getHeaders())
  ),
  "/a-member/store,-then-set-a-header": res => (
    (res[outgoing.kOutHeaders] = { __proto__: null, "x-two": ["X-Two", "2"] }),
    res.setHeader("X-Three", "3"),
    show(res.getHeaders())
  ),
  "/a-variable/read": res => show(res[kept]),
  "/a-variable/read-in-a-chain": res => show(res?.[kept]),
  "/a-variable/a-pattern": res => (({ [kept]: found }) => show(found))(res),
  "/a-variable/in": res => (kept in res) + " " + Object.hasOwn(res, kept) + " " + res.hasOwnProperty(kept),
  "/a-variable/a-descriptor": res => show(Object.getOwnPropertyDescriptor(res, kept).value),
  "/a-variable/Reflect.get": res => show(Reflect.get(res, kept)) + " " + Reflect.has(res, kept),
  "/a-variable/change-what-is-read": res => ((res[kept]["x-two"] = ["X-Two", "2"]), show(res.getHeaders())),
  "/a-variable/store-a-map": res => (
    (res[kept] = { __proto__: null, "x-two": ["X-Two", "2"] }),
    show(res.getHeaders())
  ),
  "/a-variable/store-null": res => ((res[kept] = null), show(res.getHeaders())),
  "/a-variable/store-a-map-if-there-is-none": res => (
    (res[kept] ??= { __proto__: null, "x-two": ["X-Two", "2"] }),
    show(res.getHeaders())
  ),
  "/a-variable/Reflect.set": res =>
    Reflect.set(res, kept, { __proto__: null, "x-two": ["X-Two", "2"] }) + " " + show(res.getHeaders()),
  "/a-variable/define": res => (
    Object.defineProperty(res, kept, {
      value: { __proto__: null, "x-two": ["X-Two", "2"] },
      writable: true,
      enumerable: true,
      configurable: true,
    }),
    show(res.getHeaders())
  ),
  "/a-variable/store,-then-set-a-header": res => (
    (res[kept] = { __proto__: null, "x-two": ["X-Two", "2"] }),
    res.setHeader("X-Three", "3"),
    show(res.getHeaders())
  ),
  "/process/read": res => show(res[fromProcess]),
  "/process/read-in-a-chain": res => show(res?.[fromProcess]),
  "/process/a-pattern": res => (({ [fromProcess]: found }) => show(found))(res),
  "/process/in": res =>
    (fromProcess in res) + " " + Object.hasOwn(res, fromProcess) + " " + res.hasOwnProperty(fromProcess),
  "/process/a-descriptor": res => show(Object.getOwnPropertyDescriptor(res, fromProcess).value),
  "/process/Reflect.get": res => show(Reflect.get(res, fromProcess)) + " " + Reflect.has(res, fromProcess),
  "/process/change-what-is-read": res => ((res[fromProcess]["x-two"] = ["X-Two", "2"]), show(res.getHeaders())),
  "/process/store-a-map": res => (
    (res[fromProcess] = { __proto__: null, "x-two": ["X-Two", "2"] }),
    show(res.getHeaders())
  ),
  "/process/store-null": res => ((res[fromProcess] = null), show(res.getHeaders())),
  "/process/store-a-map-if-there-is-none": res => (
    (res[fromProcess] ??= { __proto__: null, "x-two": ["X-Two", "2"] }),
    show(res.getHeaders())
  ),
  "/process/Reflect.set": res =>
    Reflect.set(res, fromProcess, { __proto__: null, "x-two": ["X-Two", "2"] }) + " " + show(res.getHeaders()),
  "/process/define": res => (
    Object.defineProperty(res, fromProcess, {
      value: { __proto__: null, "x-two": ["X-Two", "2"] },
      writable: true,
      enumerable: true,
      configurable: true,
    }),
    show(res.getHeaders())
  ),
  "/process/store,-then-set-a-header": res => (
    (res[fromProcess] = { __proto__: null, "x-two": ["X-Two", "2"] }),
    res.setHeader("X-Three", "3"),
    show(res.getHeaders())
  ),
  "/a-holder/read": res => show(res[holder.key]),
  "/a-holder/read-in-a-chain": res => show(res?.[holder.key]),
  "/a-holder/a-pattern": res => (({ [holder.key]: found }) => show(found))(res),
  "/a-holder/in": res =>
    (holder.key in res) + " " + Object.hasOwn(res, holder.key) + " " + res.hasOwnProperty(holder.key),
  "/a-holder/a-descriptor": res => show(Object.getOwnPropertyDescriptor(res, holder.key).value),
  "/a-holder/Reflect.get": res => show(Reflect.get(res, holder.key)) + " " + Reflect.has(res, holder.key),
  "/a-holder/change-what-is-read": res => ((res[holder.key]["x-two"] = ["X-Two", "2"]), show(res.getHeaders())),
  "/a-holder/store-a-map": res => (
    (res[holder.key] = { __proto__: null, "x-two": ["X-Two", "2"] }),
    show(res.getHeaders())
  ),
  "/a-holder/store-null": res => ((res[holder.key] = null), show(res.getHeaders())),
  "/a-holder/store-a-map-if-there-is-none": res => (
    (res[holder.key] ??= { __proto__: null, "x-two": ["X-Two", "2"] }),
    show(res.getHeaders())
  ),
  "/a-holder/Reflect.set": res =>
    Reflect.set(res, holder.key, { __proto__: null, "x-two": ["X-Two", "2"] }) + " " + show(res.getHeaders()),
  "/a-holder/define": res => (
    Object.defineProperty(res, holder.key, {
      value: { __proto__: null, "x-two": ["X-Two", "2"] },
      writable: true,
      enumerable: true,
      configurable: true,
    }),
    show(res.getHeaders())
  ),
  "/a-holder/store,-then-set-a-header": res => (
    (res[holder.key] = { __proto__: null, "x-two": ["X-Two", "2"] }),
    res.setHeader("X-Three", "3"),
    show(res.getHeaders())
  ),
  "/a-function/read": res => show(res[answered()]),
  "/a-function/read-in-a-chain": res => show(res?.[answered()]),
  "/a-function/a-pattern": res => (({ [answered()]: found }) => show(found))(res),
  "/a-function/in": res =>
    (answered() in res) + " " + Object.hasOwn(res, answered()) + " " + res.hasOwnProperty(answered()),
  "/a-function/a-descriptor": res => show(Object.getOwnPropertyDescriptor(res, answered()).value),
  "/a-function/Reflect.get": res => show(Reflect.get(res, answered())) + " " + Reflect.has(res, answered()),
  "/a-function/change-what-is-read": res => ((res[answered()]["x-two"] = ["X-Two", "2"]), show(res.getHeaders())),
  "/a-function/store-a-map": res => (
    (res[answered()] = { __proto__: null, "x-two": ["X-Two", "2"] }),
    show(res.getHeaders())
  ),
  "/a-function/store-null": res => ((res[answered()] = null), show(res.getHeaders())),
  "/a-function/store-a-map-if-there-is-none": res => (
    (res[answered()] ??= { __proto__: null, "x-two": ["X-Two", "2"] }),
    show(res.getHeaders())
  ),
  "/a-function/Reflect.set": res =>
    Reflect.set(res, answered(), { __proto__: null, "x-two": ["X-Two", "2"] }) + " " + show(res.getHeaders()),
  "/a-function/define": res => (
    Object.defineProperty(res, answered(), {
      value: { __proto__: null, "x-two": ["X-Two", "2"] },
      writable: true,
      enumerable: true,
      configurable: true,
    }),
    show(res.getHeaders())
  ),
  "/a-function/store,-then-set-a-header": res => (
    (res[answered()] = { __proto__: null, "x-two": ["X-Two", "2"] }),
    res.setHeader("X-Three", "3"),
    show(res.getHeaders())
  ),
  "/at-the-use/read": res => show(res[require("node:_http_outgoing").kOutHeaders]),
  "/at-the-use/read-in-a-chain": res => show(res?.[require("node:_http_outgoing").kOutHeaders]),
  "/at-the-use/a-pattern": res => (({ [require("node:_http_outgoing").kOutHeaders]: found }) => show(found))(res),
  "/at-the-use/in": res =>
    (require("node:_http_outgoing").kOutHeaders in res) +
    " " +
    Object.hasOwn(res, require("node:_http_outgoing").kOutHeaders) +
    " " +
    res.hasOwnProperty(require("node:_http_outgoing").kOutHeaders),
  "/at-the-use/a-descriptor": res =>
    show(Object.getOwnPropertyDescriptor(res, require("node:_http_outgoing").kOutHeaders).value),
  "/at-the-use/Reflect.get": res =>
    show(Reflect.get(res, require("node:_http_outgoing").kOutHeaders)) +
    " " +
    Reflect.has(res, require("node:_http_outgoing").kOutHeaders),
  "/at-the-use/change-what-is-read": res => (
    (res[require("node:_http_outgoing").kOutHeaders]["x-two"] = ["X-Two", "2"]),
    show(res.getHeaders())
  ),
  "/at-the-use/store-a-map": res => (
    (res[require("node:_http_outgoing").kOutHeaders] = { __proto__: null, "x-two": ["X-Two", "2"] }),
    show(res.getHeaders())
  ),
  "/at-the-use/store-null": res => ((res[require("node:_http_outgoing").kOutHeaders] = null), show(res.getHeaders())),
  "/at-the-use/store-a-map-if-there-is-none": res => (
    (res[require("node:_http_outgoing").kOutHeaders] ??= { __proto__: null, "x-two": ["X-Two", "2"] }),
    show(res.getHeaders())
  ),
  "/at-the-use/Reflect.set": res =>
    Reflect.set(res, require("node:_http_outgoing").kOutHeaders, { __proto__: null, "x-two": ["X-Two", "2"] }) +
    " " +
    show(res.getHeaders()),
  "/at-the-use/define": res => (
    Object.defineProperty(res, require("node:_http_outgoing").kOutHeaders, {
      value: { __proto__: null, "x-two": ["X-Two", "2"] },
      writable: true,
      enumerable: true,
      configurable: true,
    }),
    show(res.getHeaders())
  ),
  "/at-the-use/store,-then-set-a-header": res => (
    (res[require("node:_http_outgoing").kOutHeaders] = { __proto__: null, "x-two": ["X-Two", "2"] }),
    res.setHeader("X-Three", "3"),
    show(res.getHeaders())
  ),
};
const server = http.createServer((req, res) => {
  res.setHeader("X-One", "1");
  let seen;
  try {
    seen = steps[req.url](res);
  } catch (error) {
    seen = "throws " + error.name;
  }
  lines.push(req.url + ": " + seen);
  res.end("ok");
});
server.listen(0, async () => {
  for (const path of Object.keys(steps)) {
    const response = await fetch("http://127.0.0.1:" + server.address().port + path);
    lines.push(
      "  " +
        response.headers.get("x-one") +
        " " +
        response.headers.get("x-two") +
        " " +
        response.headers.get("x-three") +
        " " +
        (await response.text()),
    );
  }
  console.log(lines.join("\n"));
  server.close();
});
