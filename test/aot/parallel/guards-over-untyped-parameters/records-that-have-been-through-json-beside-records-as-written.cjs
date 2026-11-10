"use strict";
// One untyped function reads two names off its parameter; one record of the program has those names. What arrives: that record as written, the same names out of JSON, the names in another order,
// one name missing, a getter under one name, an object that has the names from above, a proxy, a primitive and nothing at all. Both functions are called off an object that is read under a name out of JSON,
// so nothing is seen to arrive at them. Every answer is plain Bun's.
const through = value => JSON.parse(JSON.stringify(value));
let log = "";
function weigh(request) { return request.method.length + request.path.length * 3; }
function route(request) { let hits = 0; for (const known of routes) { if (known.method !== request.method) continue; if (known.path === request.path) hits += known.path.length; } return hits; }
const routes = [{ method: "GET", path: "/a" }, { method: "POST", path: "/bb" }, { method: "GET", path: "/ccc" }];
globalThis.handedOut = { weigh, route };
const out = globalThis[JSON.parse('"handedOut"')];
const arrivals = [
  () => ({ method: "GET", path: "/a" }),
  () => through({ method: "GET", path: "/ccc" }),
  () => through({ path: "/bb", method: "POST" }),
  () => ({ path: "/bb", method: "POST" }),
  () => Object.create(through({ method: "GET", path: "/ccc" })),
  () => ({ method: "GET", get path() { log += "g"; return "/a"; } }),
  () => new Proxy({ method: "POST", path: "/bb" }, { get(target, key) { log += "p"; return target[key]; } }),
  () => through({ method: "GET" }),
  () => "text",
  () => undefined,
];
for (let round = 0; round < 3; round++) {
  const line = [];
  for (const arrive of arrivals) {
    try { line.push(out.weigh(arrive())); } catch (error) { line.push(error.constructor.name); }
    try { line.push(out.route(arrive())); } catch (error) { line.push(error.constructor.name); }
  }
  console.log(line.join(" "), log); log = "";
}
