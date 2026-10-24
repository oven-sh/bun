// Methods of a Headers object whose header name is a constant, a parameter or a loop variable: on the result of `new Headers(..)` and of `x.headers`, on a subclass, on objects of other classes with methods of the same names, and on a Headers object whose method or prototype was replaced.
export function madeHere(type, id) {
  const headers = new Headers();
  headers.set("content-type", type);
  headers.append("x-request-id", id);
  headers.append("Set-Cookie", id);
  const had = headers.has("X-Request-Id");
  headers.delete("x-request-id");
  return [had, new Response("x", { headers })];
}
export function madeFromInit(init) {
  return new Headers(init).get("content-type");
}
export function returned(value) {
  const headers = new Headers({ accept: "*/*" });
  headers.set("x-mine", value);
  return headers;
}
export function byParameter(name, value) {
  const headers = new Headers();
  headers.set(name, value);
  return headers;
}
export function byVariable(names) {
  const headers = new Headers();
  for (const name of names) headers.set(name, "v");
  return headers;
}
export function nameThatIsNoToken(value) {
  const headers = new Headers();
  headers.set("bad name", value);
  return headers;
}
export function handedOnFirst(holder, take) {
  const headers = holder.headers;
  take(headers);
  headers.set("x-mine", "after");
  return headers;
}
export function joinedWithAnother(given, value) {
  const headers = given ?? new Headers();
  headers.set("x-joined", value);
  return [headers, headers.get("x-joined")];
}
export function computedValue(count) {
  const headers = new Headers();
  headers.append("x-count", String(count + 1));
  return headers;
}
class Louder extends Headers {
  set(name, value) {
    super.set(name, `${value}!`);
  }
}
export function ofAnotherClass(value) {
  const headers = new Louder();
  headers.set("x-mine", value);
  return headers;
}

const describe = (error) => (/^(Invalid header name|Header '|Not enough arguments|Cannot convert a symbol|from )/.test(error.message) ? `${error.name}: ${error.message}` : error.name);
const show = (value) => (value instanceof Headers ? JSON.stringify([[...value], value.getSetCookie()]) : value instanceof Response ? show(value.headers) : value instanceof Map ? `Map ${JSON.stringify([...value])}` : Array.isArray(value) ? value.map(show).join(" . ") : String(value));
function attempt(run) {
  try {
    return show(run());
  } catch (error) {
    return describe(error);
  }
}
const log = [];
const says = (label, text) => ({
  toString() {
    log.push(label);
    return text;
  },
});
const throws = (label) => ({
  toString() {
    log.push(label);
    throw new RangeError(`from ${label}`);
  },
});
const values = ["v", "", "  padded ", "two\nlines", "café", "€", 7, null, undefined, says("value", "said"), throws("value"), Symbol("s")];
for (const value of values) {
  log.length = 0;
  console.log(attempt(() => madeHere(value, "id")), "|", attempt(() => madeHere("a/b", value)), "|", attempt(() => returned(value)), "|", attempt(() => nameThatIsNoToken(value)), "|", attempt(() => ofAnotherClass(value)), "|", log.join(","));
}
for (const init of [undefined, {}, { "Content-Type": "a/b" }, [["content-type", "c/d"], ["CONTENT-TYPE", "e/f"]], new Headers({ "content-type": "g/h" }), new Map([["content-type", "of a Map"]]), null, 7, "text", { "bad name": "v" }]) console.log(attempt(() => madeFromInit(init)));
for (const name of ["content-type", "CONTENT-TYPE", "x-mine", "cache-control", "bad name", "", "café", 7, null, undefined, says("name", "x-said"), Symbol("s")]) console.log(attempt(() => byParameter(name, "v")), "|", attempt(() => byVariable([name, "x-second"])));
console.log(attempt(() => byParameter("cache-control", "no-store")), attempt(() => byParameter("x-request-id", "7")), attempt(() => byParameter("Vary", "accept")));
console.log(attempt(() => computedValue(1)), attempt(() => computedValue("1")));

console.log("== handed on first");
for (const make of [() => new Response("", { headers: { accept: "*/*" } }), () => new Request("http://localhost/"), () => ({ headers: new Headers() }), () => ({ headers: new Map() }), () => ({ headers: new Louder() }), () => ({})]) {
  const holder = make();
  const seen = [];
  const result = attempt(() => handedOnFirst(holder, (headers) => seen.push(headers)));
  console.log(result, seen[0] === holder.headers, attempt(() => holder.headers));
  console.log(
    attempt(() =>
      handedOnFirst(make(), (headers) => {
        headers.set = (name, value) => log.push(`own set of ${name} to ${value}`);
      }),
    ),
    log.pop(),
  );
  console.log(attempt(() => handedOnFirst(make(), (headers) => Object.setPrototypeOf(headers, { set: (name, value) => log.push(`another prototype's set of ${name} to ${value}`) })) === undefined), log.pop());
}

console.log("== joined with another");
for (const given of [undefined, null, new Headers({ "x-given": "yes" }), new Map(), new Louder(), new Response("").headers, new URLSearchParams("x-joined=before"), new FormData()]) console.log(attempt(() => joinedWithAnother(given, "joined")));

console.log("== in a server");
const answer = (request) => {
  const [had, response] = madeHere("text/made", request.headers.get("x-sent"));
  const more = returned(String(had));
  handedOnFirst(response, (headers) => headers.append("x-handed", more.get("x-mine")));
  return response;
};
const server = Bun.serve({ port: 0, routes: { "/routed/:id": answer }, fetch: answer });
for (const path of ["/routed/1", "/plain"]) {
  for (let turn = 0; turn < 2; turn++) {
    const response = await fetch(new URL(path, server.url), { headers: { "x-sent": `turn-${turn}` } });
    console.log(path, JSON.stringify([...response.headers].filter(([name]) => name !== "date")), await response.text());
  }
}
await server.stop(true);
