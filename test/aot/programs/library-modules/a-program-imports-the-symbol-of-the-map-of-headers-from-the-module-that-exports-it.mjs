// node:_http_outgoing exports the symbol under which a message keeps the map of its headers. A program takes it by import, by import() and by a require that the program makes,
// and looks and stores under it on the response of a server. Each look has a request of its own, and the client says which headers came.
import http from "node:http";
import { createRequire } from "node:module";
import { kOutHeaders } from "node:_http_outgoing";
import outgoing from "node:_http_outgoing";
import * as all from "node:_http_outgoing";
const { kOutHeaders: awaited } = await import("node:_http_outgoing");
const made = createRequire(import.meta.url)("node:_http_outgoing").kOutHeaders;
const { kOutHeaders: fromDefault } = outgoing;
const lines = [];
const show = value => JSON.stringify(value) ?? "undefined";
const steps = {
  "/a-name/read": res => show(res[kOutHeaders]),
  "/a-name/read-in-a-chain": res => show(res?.[kOutHeaders]),
  "/a-name/a-pattern": res => (({ [kOutHeaders]: found }) => show(found))(res),
  "/a-name/in": res =>
    (kOutHeaders in res) + " " + Object.hasOwn(res, kOutHeaders) + " " + res.hasOwnProperty(kOutHeaders),
  "/a-name/a-descriptor": res => show(Object.getOwnPropertyDescriptor(res, kOutHeaders).value),
  "/a-name/Reflect.get": res => show(Reflect.get(res, kOutHeaders)) + " " + Reflect.has(res, kOutHeaders),
  "/a-name/change-what-is-read": res => ((res[kOutHeaders]["x-two"] = ["X-Two", "2"]), show(res.getHeaders())),
  "/a-name/store-a-map": res => (
    (res[kOutHeaders] = { __proto__: null, "x-two": ["X-Two", "2"] }),
    show(res.getHeaders())
  ),
  "/a-name/store-null": res => ((res[kOutHeaders] = null), show(res.getHeaders())),
  "/a-name/store-a-map-if-there-is-none": res => (
    (res[kOutHeaders] ??= { __proto__: null, "x-two": ["X-Two", "2"] }),
    show(res.getHeaders())
  ),
  "/a-name/Reflect.set": res =>
    Reflect.set(res, kOutHeaders, { __proto__: null, "x-two": ["X-Two", "2"] }) + " " + show(res.getHeaders()),
  "/a-name/define": res => (
    Object.defineProperty(res, kOutHeaders, {
      value: { __proto__: null, "x-two": ["X-Two", "2"] },
      writable: true,
      enumerable: true,
      configurable: true,
    }),
    show(res.getHeaders())
  ),
  "/a-name/store,-then-set-a-header": res => (
    (res[kOutHeaders] = { __proto__: null, "x-two": ["X-Two", "2"] }),
    res.setHeader("X-Three", "3"),
    show(res.getHeaders())
  ),
  "/the-default/read": res => show(res[outgoing.kOutHeaders]),
  "/the-default/read-in-a-chain": res => show(res?.[outgoing.kOutHeaders]),
  "/the-default/a-pattern": res => (({ [outgoing.kOutHeaders]: found }) => show(found))(res),
  "/the-default/in": res =>
    (outgoing.kOutHeaders in res) +
    " " +
    Object.hasOwn(res, outgoing.kOutHeaders) +
    " " +
    res.hasOwnProperty(outgoing.kOutHeaders),
  "/the-default/a-descriptor": res => show(Object.getOwnPropertyDescriptor(res, outgoing.kOutHeaders).value),
  "/the-default/Reflect.get": res =>
    show(Reflect.get(res, outgoing.kOutHeaders)) + " " + Reflect.has(res, outgoing.kOutHeaders),
  "/the-default/change-what-is-read": res => (
    (res[outgoing.kOutHeaders]["x-two"] = ["X-Two", "2"]),
    show(res.getHeaders())
  ),
  "/the-default/store-a-map": res => (
    (res[outgoing.kOutHeaders] = { __proto__: null, "x-two": ["X-Two", "2"] }),
    show(res.getHeaders())
  ),
  "/the-default/store-null": res => ((res[outgoing.kOutHeaders] = null), show(res.getHeaders())),
  "/the-default/store-a-map-if-there-is-none": res => (
    (res[outgoing.kOutHeaders] ??= { __proto__: null, "x-two": ["X-Two", "2"] }),
    show(res.getHeaders())
  ),
  "/the-default/Reflect.set": res =>
    Reflect.set(res, outgoing.kOutHeaders, { __proto__: null, "x-two": ["X-Two", "2"] }) + " " + show(res.getHeaders()),
  "/the-default/define": res => (
    Object.defineProperty(res, outgoing.kOutHeaders, {
      value: { __proto__: null, "x-two": ["X-Two", "2"] },
      writable: true,
      enumerable: true,
      configurable: true,
    }),
    show(res.getHeaders())
  ),
  "/the-default/store,-then-set-a-header": res => (
    (res[outgoing.kOutHeaders] = { __proto__: null, "x-two": ["X-Two", "2"] }),
    res.setHeader("X-Three", "3"),
    show(res.getHeaders())
  ),
  "/a-star/read": res => show(res[all.kOutHeaders]),
  "/a-star/read-in-a-chain": res => show(res?.[all.kOutHeaders]),
  "/a-star/a-pattern": res => (({ [all.kOutHeaders]: found }) => show(found))(res),
  "/a-star/in": res =>
    (all.kOutHeaders in res) + " " + Object.hasOwn(res, all.kOutHeaders) + " " + res.hasOwnProperty(all.kOutHeaders),
  "/a-star/a-descriptor": res => show(Object.getOwnPropertyDescriptor(res, all.kOutHeaders).value),
  "/a-star/Reflect.get": res => show(Reflect.get(res, all.kOutHeaders)) + " " + Reflect.has(res, all.kOutHeaders),
  "/a-star/change-what-is-read": res => ((res[all.kOutHeaders]["x-two"] = ["X-Two", "2"]), show(res.getHeaders())),
  "/a-star/store-a-map": res => (
    (res[all.kOutHeaders] = { __proto__: null, "x-two": ["X-Two", "2"] }),
    show(res.getHeaders())
  ),
  "/a-star/store-null": res => ((res[all.kOutHeaders] = null), show(res.getHeaders())),
  "/a-star/store-a-map-if-there-is-none": res => (
    (res[all.kOutHeaders] ??= { __proto__: null, "x-two": ["X-Two", "2"] }),
    show(res.getHeaders())
  ),
  "/a-star/Reflect.set": res =>
    Reflect.set(res, all.kOutHeaders, { __proto__: null, "x-two": ["X-Two", "2"] }) + " " + show(res.getHeaders()),
  "/a-star/define": res => (
    Object.defineProperty(res, all.kOutHeaders, {
      value: { __proto__: null, "x-two": ["X-Two", "2"] },
      writable: true,
      enumerable: true,
      configurable: true,
    }),
    show(res.getHeaders())
  ),
  "/a-star/store,-then-set-a-header": res => (
    (res[all.kOutHeaders] = { __proto__: null, "x-two": ["X-Two", "2"] }),
    res.setHeader("X-Three", "3"),
    show(res.getHeaders())
  ),
  "/an-import-call/read": res => show(res[awaited]),
  "/an-import-call/read-in-a-chain": res => show(res?.[awaited]),
  "/an-import-call/a-pattern": res => (({ [awaited]: found }) => show(found))(res),
  "/an-import-call/in": res => (awaited in res) + " " + Object.hasOwn(res, awaited) + " " + res.hasOwnProperty(awaited),
  "/an-import-call/a-descriptor": res => show(Object.getOwnPropertyDescriptor(res, awaited).value),
  "/an-import-call/Reflect.get": res => show(Reflect.get(res, awaited)) + " " + Reflect.has(res, awaited),
  "/an-import-call/change-what-is-read": res => ((res[awaited]["x-two"] = ["X-Two", "2"]), show(res.getHeaders())),
  "/an-import-call/store-a-map": res => (
    (res[awaited] = { __proto__: null, "x-two": ["X-Two", "2"] }),
    show(res.getHeaders())
  ),
  "/an-import-call/store-null": res => ((res[awaited] = null), show(res.getHeaders())),
  "/an-import-call/store-a-map-if-there-is-none": res => (
    (res[awaited] ??= { __proto__: null, "x-two": ["X-Two", "2"] }),
    show(res.getHeaders())
  ),
  "/an-import-call/Reflect.set": res =>
    Reflect.set(res, awaited, { __proto__: null, "x-two": ["X-Two", "2"] }) + " " + show(res.getHeaders()),
  "/an-import-call/define": res => (
    Object.defineProperty(res, awaited, {
      value: { __proto__: null, "x-two": ["X-Two", "2"] },
      writable: true,
      enumerable: true,
      configurable: true,
    }),
    show(res.getHeaders())
  ),
  "/an-import-call/store,-then-set-a-header": res => (
    (res[awaited] = { __proto__: null, "x-two": ["X-Two", "2"] }),
    res.setHeader("X-Three", "3"),
    show(res.getHeaders())
  ),
  "/a-require-that-was-made/read": res => show(res[made]),
  "/a-require-that-was-made/read-in-a-chain": res => show(res?.[made]),
  "/a-require-that-was-made/a-pattern": res => (({ [made]: found }) => show(found))(res),
  "/a-require-that-was-made/in": res => (made in res) + " " + Object.hasOwn(res, made) + " " + res.hasOwnProperty(made),
  "/a-require-that-was-made/a-descriptor": res => show(Object.getOwnPropertyDescriptor(res, made).value),
  "/a-require-that-was-made/Reflect.get": res => show(Reflect.get(res, made)) + " " + Reflect.has(res, made),
  "/a-require-that-was-made/change-what-is-read": res => (
    (res[made]["x-two"] = ["X-Two", "2"]),
    show(res.getHeaders())
  ),
  "/a-require-that-was-made/store-a-map": res => (
    (res[made] = { __proto__: null, "x-two": ["X-Two", "2"] }),
    show(res.getHeaders())
  ),
  "/a-require-that-was-made/store-null": res => ((res[made] = null), show(res.getHeaders())),
  "/a-require-that-was-made/store-a-map-if-there-is-none": res => (
    (res[made] ??= { __proto__: null, "x-two": ["X-Two", "2"] }),
    show(res.getHeaders())
  ),
  "/a-require-that-was-made/Reflect.set": res =>
    Reflect.set(res, made, { __proto__: null, "x-two": ["X-Two", "2"] }) + " " + show(res.getHeaders()),
  "/a-require-that-was-made/define": res => (
    Object.defineProperty(res, made, {
      value: { __proto__: null, "x-two": ["X-Two", "2"] },
      writable: true,
      enumerable: true,
      configurable: true,
    }),
    show(res.getHeaders())
  ),
  "/a-require-that-was-made/store,-then-set-a-header": res => (
    (res[made] = { __proto__: null, "x-two": ["X-Two", "2"] }),
    res.setHeader("X-Three", "3"),
    show(res.getHeaders())
  ),
  "/a-pattern-of-the-default/read": res => show(res[fromDefault]),
  "/a-pattern-of-the-default/read-in-a-chain": res => show(res?.[fromDefault]),
  "/a-pattern-of-the-default/a-pattern": res => (({ [fromDefault]: found }) => show(found))(res),
  "/a-pattern-of-the-default/in": res =>
    (fromDefault in res) + " " + Object.hasOwn(res, fromDefault) + " " + res.hasOwnProperty(fromDefault),
  "/a-pattern-of-the-default/a-descriptor": res => show(Object.getOwnPropertyDescriptor(res, fromDefault).value),
  "/a-pattern-of-the-default/Reflect.get": res =>
    show(Reflect.get(res, fromDefault)) + " " + Reflect.has(res, fromDefault),
  "/a-pattern-of-the-default/change-what-is-read": res => (
    (res[fromDefault]["x-two"] = ["X-Two", "2"]),
    show(res.getHeaders())
  ),
  "/a-pattern-of-the-default/store-a-map": res => (
    (res[fromDefault] = { __proto__: null, "x-two": ["X-Two", "2"] }),
    show(res.getHeaders())
  ),
  "/a-pattern-of-the-default/store-null": res => ((res[fromDefault] = null), show(res.getHeaders())),
  "/a-pattern-of-the-default/store-a-map-if-there-is-none": res => (
    (res[fromDefault] ??= { __proto__: null, "x-two": ["X-Two", "2"] }),
    show(res.getHeaders())
  ),
  "/a-pattern-of-the-default/Reflect.set": res =>
    Reflect.set(res, fromDefault, { __proto__: null, "x-two": ["X-Two", "2"] }) + " " + show(res.getHeaders()),
  "/a-pattern-of-the-default/define": res => (
    Object.defineProperty(res, fromDefault, {
      value: { __proto__: null, "x-two": ["X-Two", "2"] },
      writable: true,
      enumerable: true,
      configurable: true,
    }),
    show(res.getHeaders())
  ),
  "/a-pattern-of-the-default/store,-then-set-a-header": res => (
    (res[fromDefault] = { __proto__: null, "x-two": ["X-Two", "2"] }),
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
