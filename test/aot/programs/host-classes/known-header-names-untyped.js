// `x.headers.get(name)` with a constant name: well-known names in lower case and in capitals, set-cookie, another valid name, every character a name may have, invalid names, and a variable beside them. For every kind of holder, before and after its Headers object is changed.
export function contentType(holder) {
  return holder.headers.get("content-type");
}
export function contentTypeInCapitals(holder) {
  return holder.headers.get("CONTENT-Type");
}
export function firstName(holder) {
  return holder.headers.get("accept");
}
export function lastName(holder) {
  return holder.headers.get("X-XSS-Protection");
}
export function setCookie(holder) {
  return holder.headers.get("set-cookie");
}
export function uncommon(holder) {
  return holder.headers.get("X-Mine");
}
export function everyTokenCharacter(holder) {
  return holder.headers.get("!#$%&'*+-.^_`|~09azAZ");
}
export function withSpace(holder) {
  return holder.headers.get("bad name");
}
export function withColon(holder) {
  return holder.headers.get("x:y");
}
export function empty(holder) {
  return holder.headers.get("");
}
export function notASCII(holder) {
  return holder.headers.get("café");
}
export function variable(holder, name) {
  return holder.headers.get(name);
}
const reads = [contentType, contentTypeInCapitals, firstName, lastName, setCookie, uncommon, everyTokenCharacter, withSpace, withColon, empty, notASCII];
function attempt(run) {
  try {
    return run();
  } catch (error) {
    return `${error.name}: ${error.message}`;
  }
}
const rowsOf = (holder) => [...reads.map((read) => attempt(() => read(holder))), variable(holder, "content-type"), variable(holder, "x-MINE"), attempt(() => variable(holder, "bad name"))];

const full = () => {
  const headers = new Headers({ "Content-Type": "a/b", Accept: "*/*", "x-xss-protection": "0", "x-mine": "mine", "!#$%&'*+-.^_`|~09azAZ": "every" });
  headers.append("set-cookie", "a=1");
  headers.append("set-cookie", "b=2");
  headers.append("x-mine", "again");
  return headers;
};
const holders = {
  "a Response with all": () => new Response("", { headers: full() }),
  "a Response with none": () => new Response(null),
  "a Response of a string": () => new Response("text"),
  "a Response of a Blob with a type": () => new Response(new Blob(["x"], { type: "from/blob" })),
  "Response.json": () => Response.json({}),
  "Response.redirect": () => Response.redirect("http://localhost/"),
  "a clone": () => new Response("", { headers: full() }).clone(),
  "made from another and its body": () => ((first) => new Response(first.body, first))(new Response("x", { headers: full() })),
  "a Request with all": () => new Request("http://localhost/", { headers: full() }),
  "a Request with none": () => new Request("http://localhost/"),
  "a Request with a Blob": () => new Request("http://localhost/", { method: "POST", body: new Blob(["x"], { type: "from/blob" }) }),
  "something else": () => ({ headers: new Map([["content-type", "of a Map"], ["X-Mine", "of a Map, by the very key"]]) }),
  "Headers in a plain object": () => ({ headers: full() }),
};
for (const [label, make] of Object.entries(holders)) {
  console.log(label, JSON.stringify(rowsOf(make())));
  const holder = make();
  console.log(label + ", read twice, then with the object in hand", JSON.stringify([contentType(holder), contentType(holder), typeof holder.headers, contentType(holder), uncommon(holder)]));
}

for (const make of [holders["a Response with all"], holders["a Request with all"]]) {
  const changed = make();
  changed.headers.set("content-type", "changed");
  changed.headers.delete("x-mine");
  const ownGet = make();
  ownGet.headers.get = (name) => `own get of ${name}`;
  const otherPrototype = make();
  Object.setPrototypeOf(otherPrototype.headers, { get: (name) => `another prototype's get of ${name}` });
  const ownHeaders = make();
  Object.defineProperty(ownHeaders, "headers", { value: new Headers({ "content-type": "own headers" }) });
  console.log(JSON.stringify([changed, ownGet, otherPrototype, ownHeaders].map((holder) => [contentType(holder), uncommon(holder), variable(holder, "accept")])));
}
class Subclass extends Response {}
class Overriding extends Response {
  get headers() {
    return new Headers({ "content-type": "overridden" });
  }
}
console.log(JSON.stringify([contentType(new Subclass("", { headers: { "content-type": "subclass" } })), contentType(new Overriding(""))]));

const server = Bun.serve({
  port: 0,
  routes: { "/routed": (request) => Response.json(rowsOf(request), { headers: { "x-mine": "answer", "set-cookie": "s=1" } }) },
  fetch: (request) => Response.json(rowsOf(request), { headers: { "x-mine": "answer", "set-cookie": "s=1" } }),
});
for (const path of ["/routed", "/plain"]) {
  for (const headers of [full(), new Headers()]) {
    const response = await fetch(new URL(path, server.url), { headers });
    console.log(path, JSON.stringify([contentType(response), uncommon(response), setCookie(response), firstName(response), variable(response, "X-MINE")]), await response.text());
  }
}
await server.stop(true);
