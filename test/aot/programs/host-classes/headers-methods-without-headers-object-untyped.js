// get, has, set, append and delete on the result of `x.headers`: called at once, through a variable, after a join with another Headers object, in a try block and in a loop. For every kind of holder, name and value, and whatever happens to the Headers object or its holder before the call or while the arguments are evaluated.
export function setOne(holder, value) {
  holder.headers.set("content-type", value);
}
export function appendOne(holder, name, value) {
  holder.headers.append(name, value);
}
export function deleteOne(holder, name) {
  return holder.headers.delete(name);
}
export function hasOne(holder, name) {
  return holder.headers.has(name);
}
export function getOne(holder, name) {
  return holder.headers.get(name);
}
export function setThenRead(holder, name, value) {
  const headers = holder.headers;
  headers.set(name, value);
  return [headers.get(name), headers.has("x-mine")];
}
export function joined(state, name, value, options) {
  const headers = state.response ? state.response.headers : (state.prepared ??= new Headers());
  if (value === undefined) headers.delete(name);
  else if (options?.append) headers.append(name, value);
  else headers.set(name, value);
}
export function withCallBetween(holder, between, name, value) {
  const headers = holder.headers;
  between(holder);
  return headers.set(name, value);
}
export function insideTry(holder, name, value) {
  try {
    holder.headers.set(name, value);
    return "set";
  } catch (error) {
    return describe(error);
  }
}
export function inLoop(holder, count) {
  for (let i = 0; i < count; i++) holder.headers.append("x-turn", String(i));
}
export function computedValue(holder, make) {
  return holder.headers.set("x-computed", make(holder));
}
export function computedName(holder, make) {
  return holder.headers.has(make(holder));
}
export function computedInJoin(state, name, make) {
  const headers = state.response ? state.response.headers : (state.prepared ??= new Headers());
  headers.append(name, make(state.response));
  return headers.get(name);
}
export function methodKept(holder, value) {
  const headers = holder.headers;
  const set = headers.set;
  return [set.call(headers, "x-kept", value), typeof set];
}
export function escapesByReturn(holder) {
  const headers = holder.headers;
  headers.set("x-mine", "kept");
  return headers;
}
export function escapesAsArgument(holder, take) {
  const headers = holder.headers;
  headers.set("x-mine", "handed on");
  return take(headers);
}
export function isTested(holder) {
  const headers = holder.headers;
  if (headers) headers.set("x-mine", "tested");
}
export function otherMethod(holder) {
  const headers = holder.headers;
  headers.set("x-mine", "listed");
  return [...headers.keys()];
}
export function tooFewArguments(holder) {
  holder.headers.set("x-mine");
}
export function tooManyArguments(holder) {
  holder.headers.set("x-mine", "two", "three");
}

const describe = (error) => (/^(Invalid header name|Header '|Not enough arguments|Cannot convert a symbol|while the argument)/.test(error.message) ? `${error.name}: ${error.message}` : error.name);
function attempt(run) {
  try {
    return run();
  } catch (error) {
    return describe(error);
  }
}
const list = (holder) => attempt(() => JSON.stringify([[...holder.headers], typeof holder.headers.getSetCookie === "function" ? holder.headers.getSetCookie() : "-"]));
const filled = () => new Headers({ "Content-Type": "a/b", Accept: "*/*", "x-mine": "mine", "X-Other": "other", cookie: "c=1" });
class Subclass extends Response {}
class Overriding extends Response {
  #own = new Headers({ "x-own": "overridden" });
  get headers() {
    return this.#own;
  }
}
const holders = {
  "a Response with headers": () => new Response("", { headers: filled() }),
  "a Response without": () => new Response(null),
  "a Response of a Blob with a type": () => new Response(new Blob(["x"], { type: "from/blob" })),
  "Response.json": () => Response.json({}),
  "a clone": () => new Response("", { headers: filled() }).clone(),
  "a Request with headers": () => new Request("http://localhost/", { headers: filled() }),
  "a Request without": () => new Request("http://localhost/"),
  "a subclass": () => new Subclass("", { headers: filled() }),
  "a subclass with its own getter": () => new Overriding(""),
  "Headers in a plain object": () => ({ headers: filled() }),
  "a Map in a plain object": () => ({ headers: new Map([["content-type", "of a Map"]]) }),
  "a Response in a plain object": () => ({ headers: new Response("") }),
  "nothing in a plain object": () => ({}),
};
const log = [];
const says = (label, text) => ({
  toString() {
    log.push(label);
    return text;
  },
});
const names = ["content-type", "CONTENT-TYPE", "x-mine", "X-MINE", "x-new", "set-cookie", "cookie", "bad name", "", "café", 7, null, undefined, says("name", "x-said"), Symbol("s")];
const values = ["v", "", "  padded ", "two\nlines", "café", "€", 7, null, undefined, says("value", "said"), Symbol("s")];

for (const [label, make] of Object.entries(holders)) {
  console.log("==", label);
  for (const value of values) {
    const holder = make();
    console.log("setOne", String(attempt(() => setOne(holder, value))), list(holder));
  }
  for (const name of names) {
    log.length = 0;
    const rows = [];
    let holder = make();
    rows.push(attempt(() => appendOne(holder, name, says("value", "appended"))), list(holder));
    rows.push(attempt(() => appendOne(holder, name, "again")), list(holder));
    rows.push(attempt(() => hasOne(holder, name)), attempt(() => getOne(holder, name)));
    rows.push(attempt(() => deleteOne(holder, name)), list(holder), attempt(() => hasOne(holder, name)));
    holder = make();
    rows.push(attempt(() => JSON.stringify(setThenRead(holder, name, "set"))), list(holder));
    rows.push(insideTry(make(), name, "tried"), insideTry(make(), "x-tried", name));
    console.log(typeof name === "symbol" ? "symbol" : JSON.stringify(String(name)), rows.map(String).join(" | "), log.join(","));
  }
  const turned = make();
  console.log("inLoop", String(attempt(() => inLoop(turned, 3))), list(turned));
  for (const run of [escapesByReturn, (holder) => escapesAsArgument(holder, (headers) => headers), isTested, otherMethod, tooFewArguments, tooManyArguments]) {
    const holder = make();
    const result = attempt(() => run(holder));
    console.log(run.name || "escapesAsArgument", result === holder.headers ? "the very object" : String(result), list(holder));
  }
}

console.log("== the method is read before the arguments are evaluated");
const during = {
  "nothing happens": () => "plain",
  "the object is made": (holder) => typeof holder.headers,
  "the object gets its own set, has and append": (holder) => {
    for (const name of ["set", "has", "append"]) holder.headers[name] = () => `own ${name}`;
    return "x-during";
  },
  "the object gets another prototype": (holder) => (Object.setPrototypeOf(holder.headers, { set: () => "other set", has: () => "other has", append: () => "other append", get: () => "other get" }), "x-during"),
  "the holder gets its own headers": (holder) => (Object.defineProperty(holder, "headers", { value: new Map(), configurable: true }), "x-during"),
  "it throws": () => {
    throw new RangeError("while the argument is evaluated");
  },
};
for (const [label, make] of Object.entries(holders)) {
  for (const [what, run] of Object.entries(during)) {
    const rows = [];
    for (const call of [computedValue, computedName]) {
      const holder = make();
      rows.push(String(attempt(() => call(holder, run))));
      if (Object.hasOwn(holder, "headers") && holder instanceof Response) delete holder.headers;
      rows.push(attempt(() => JSON.stringify([...Headers.prototype.entries.call(holder.headers)])));
    }
    const state = { response: make(), prepared: undefined };
    rows.push(String(attempt(() => computedInJoin(state, "x-joined", run))));
    console.log(label, "|", what, "|", rows.join(" | "));
  }
  const changedBefore = make();
  attempt(() => (changedBefore.headers.set = () => "own set, there before"));
  console.log(label, "| changed before |", String(attempt(() => computedValue(changedBefore, () => "v"))), String(attempt(() => JSON.stringify(methodKept(make(), "v")))));
}

console.log("== joined");
for (const make of [holders["a Response with headers"], holders["a Response without"], holders["a subclass"], () => undefined, () => new Map(), () => ({ headers: new Response("") })]) {
  const state = { response: make(), prepared: undefined };
  const rows = [];
  for (const [name, value, options] of [["x-a", "1"], ["x-a", "2", { append: true }], ["content-type", "set/joined"], ["accept", undefined], ["set-cookie", "a=1", { append: true }], ["set-cookie", "b=2", { append: true }], ["bad name", "v"]])
    rows.push(String(attempt(() => joined(state, name, value, options))));
  console.log(rows.join(" | "), state.response && state.response.headers ? list(state.response) : "-", state.prepared ? JSON.stringify([...state.prepared]) : "-");
}
for (const prepared of [new Response("really a Response"), new Request("http://localhost/"), new Map(), filled()]) {
  const state = { response: undefined, prepared };
  console.log(String(attempt(() => joined(state, "x-a", "1"))), String(attempt(() => joined(state, "x-a", undefined))), prepared instanceof Map ? JSON.stringify([...prepared]) : prepared.headers ? list(prepared) : JSON.stringify([...prepared]));
}

console.log("== the object exists already, or comes to exist in between");
for (const make of [holders["a Response with headers"], holders["a Request with headers"]]) {
  const seen = make();
  const object = seen.headers;
  setOne(seen, "after/seen");
  appendOne(seen, "x-later", "1");
  console.log(object === seen.headers, object.get("content-type"), object.get("x-later"), hasOne(seen, "x-later"));
  object.set("x-by-object", "yes");
  console.log(hasOne(seen, "x-by-object"), JSON.stringify(setThenRead(seen, "x-by-object", "changed")), object.get("x-by-object"));

  const iterated = make();
  const entries = iterated.headers.entries();
  const first = entries.next().value;
  deleteOne(iterated, "content-type");
  appendOne(iterated, "x-zz", "last");
  console.log(JSON.stringify(first), JSON.stringify([...entries]));

  const ownSet = make();
  ownSet.headers.set = function (name, value) {
    return `own set of ${name} to ${value}`;
  };
  console.log(String(withCallBetween(ownSet, () => {}, "x-a", "1")), String(attempt(() => setOne(ownSet, "own/set"))), list(ownSet));

  const otherPrototype = make();
  Object.setPrototypeOf(otherPrototype.headers, { set: (name, value) => `another prototype's set of ${name} to ${value}`, has: () => "another prototype's has" });
  console.log(String(withCallBetween(otherPrototype, () => {}, "x-a", "1")), String(hasOne(otherPrototype, "x-a")));

  const changedBetween = make();
  console.log(String(withCallBetween(changedBetween, (holder) => void (holder.headers.set = () => "set in between"), "x-a", "1")), list(changedBetween));
  const ownHeadersBetween = make();
  console.log(String(withCallBetween(ownHeadersBetween, (holder) => Object.defineProperty(holder, "headers", { value: new Map(), configurable: true }), "x-a", "1")), JSON.stringify([...ownHeadersBetween.headers]), delete ownHeadersBetween.headers, list(ownHeadersBetween));
  const otherPrototypeBetween = make();
  console.log(String(withCallBetween(otherPrototypeBetween, (holder) => Object.setPrototypeOf(holder, { headers: new Map() }), "x-a", "1")), JSON.stringify([...otherPrototypeBetween.headers]));
  const ownHeaders = make();
  Object.defineProperty(ownHeaders, "headers", { value: new Map() });
  console.log(String(attempt(() => setOne(ownHeaders, "into/map"))), JSON.stringify([...ownHeaders.headers]));
}

console.log("== in a server");
const answer = (request) => {
  const before = [hasOne(request, "x-sent"), hasOne(request, "x-absent"), getOne(request, "x-sent")];
  appendOne(request, "x-sent", "more");
  setOne(request, "set/on-request");
  deleteOne(request, "accept");
  const response = Response.json([before, getOne(request, "x-sent"), getOne(request, "content-type"), hasOne(request, "accept"), JSON.stringify(setThenRead(request, "x-mine", "mine"))]);
  setOne(response, "application/mine");
  appendOne(response, "set-cookie", "a=1");
  appendOne(response, "Set-Cookie", "b=2");
  joined({ response }, "x-joined", "yes");
  joined({ response }, "x-joined", "again", { append: true });
  return response;
};
const server = Bun.serve({ port: 0, routes: { "/routed/:id": answer }, fetch: answer });
for (const path of ["/routed/1", "/plain"]) {
  for (let turn = 0; turn < 2; turn++) {
    const response = await fetch(new URL(path, server.url), { headers: { "x-sent": `turn-${turn}`, accept: "a/b" } });
    console.log(path, JSON.stringify([...response.headers].filter(([name]) => name !== "date")), await response.text());
  }
}
await server.stop(true);
