// The names of a headers literal in an init literal are looked up when the program is built: a common name is passed as its number, any other token as a string; a literal with a name that is no token stays an object.
export function commonNames(type: string, cache: string): Response {
  return new Response("x", { headers: { "content-type": type, "cache-control": cache } });
}
export function commonNamesInCapitals(type: string): Response {
  return new Response("x", { headers: { "CONTENT-Type": type } });
}
export function uncommonNames(first: string, second: string): Response {
  return new Response("x", { status: 201, headers: { "x-request-id": first, "X-Content-Type-Options": second } });
}
export function jsonWithBoth(id: string, cache: string): Response {
  return Response.json({ id }, { headers: { "X-Request-Id": id, "Cache-Control": cache } });
}
export function nameWithSpace(value: string): Response {
  return new Response("x", { status: 202, headers: { accept: "*/*", "bad name": value } });
}
export function nameThatIsNotASCII(value: string): Response {
  return new Response("x", { headers: { café: value } });
}
export function sameNameInTwoCases(first: string, second: string): Response {
  return new Response("x", { headers: { Accept: first, accept: second, "X-Mine": first, "x-mine": second, Cookie: first, cookie: second, "Set-Cookie": first, "set-cookie": second } });
}
export function anyValues(first: unknown, second: unknown, third: unknown): Response {
  return new Response("x", { headers: { "content-language": first, "x-second": second, etag: third } as Record<string, string> });
}
export function jsonWithContentType(type: string): Response {
  return Response.json([1], { headers: { "Content-Type": type } });
}
export function blobWithContentType(type: string): Response {
  return new Response(new Blob(["x"], { type: "from/blob" }), { headers: { "content-TYPE": type } });
}
export function blobWithoutContentType(mine: string): Response {
  return new Response(new Blob(["x"], { type: "from/blob" }), { headers: { "x-mine": mine } });
}
export function twelveHeaders(value: string): Response {
  return new Response("x", {
    headers: { accept: value, "x-1": value, age: value, "x-2": value, date: value, "x-3": value, etag: value, "x-4": value, host: value, "x-5": value, via: value, "x-6": value },
  });
}

function show(make: () => Response): string {
  try {
    const response = make();
    return JSON.stringify([response.status, [...response.headers], response.headers.getSetCookie()]);
  } catch (error) {
    return `${(error as Error).name}: ${(error as Error).message}`;
  }
}

console.log(show(() => commonNames("a/b", "no-store")));
console.log(show(() => commonNamesInCapitals("a/b")));
console.log(show(() => uncommonNames("one", "nosniff")));
console.log(show(() => jsonWithBoth("seven", "no-store")));
console.log(show(() => nameWithSpace("v")));
console.log(show(() => nameThatIsNotASCII("v")));
console.log(show(() => sameNameInTwoCases("a=1", "b=2")));
console.log(show(() => jsonWithContentType("mine/json")));
console.log(show(() => blobWithContentType("mine/blob")));
console.log(show(() => blobWithoutContentType("mine")));
console.log(show(() => twelveHeaders("v")));

for (const value of ["", " ", "  padded\t", "\tx y ", "two\nlines", "a\0b", "carriage\rreturn", "café", "€", "x".repeat(300)]) {
  console.log(JSON.stringify(value.slice(0, 20)), show(() => commonNames(value, "ok")), show(() => commonNames("ok", value)), show(() => uncommonNames(value, "ok")), show(() => uncommonNames("ok", value)), show(() => jsonWithBoth(value, "ok")));
}

const log: string[] = [];
const says = (name: string, text: string) => ({
  toString() {
    log.push(name);
    return text;
  },
});
const throws = (name: string) => ({
  toString() {
    log.push(name);
    throw new RangeError(`from ${name}`);
  },
});
const rows: [unknown, unknown, unknown][] = [
  [1, 2.5, -0],
  [true, null, undefined],
  [says("first", "en"), says("second", "two"), says("third", "three")],
  [says("first", "bad\nvalue"), says("second", "two"), says("third", "three")],
  [says("first", "en"), throws("second"), says("third", "three")],
  [says("first", "en"), says("second", "two"), Symbol("third")],
  [[1, 2], { a: 1 }, 10n],
  ["left" + "-".repeat(3) + String(log.length), `rope-${log.length}-${"y".repeat(20)}`, "z"],
];
for (const [first, second, third] of rows) {
  log.length = 0;
  console.log(show(() => anyValues(first, second, third)), log.join(" "));
}

const kept = commonNames("kept/one", "no-store");
kept.headers.set("content-type", "changed");
kept.headers.append("x-later", "added");
kept.headers.delete("cache-control");
console.log(JSON.stringify([...kept.headers]), JSON.stringify([...commonNames("kept/two", "no-cache").headers]));
const copy = new Response(kept.body, kept);
console.log(JSON.stringify([...copy.headers]), JSON.stringify([...uncommonNames("a", "b").clone().headers]));

const server = Bun.serve({
  port: 0,
  routes: {
    "/routed/:id": (request) => new Response(request.params.id, { status: 203, headers: { "content-type": "text/routed", "x-request-id": request.headers.get("x-request-id") ?? "none", "Set-Cookie": "a=1", "set-cookie": "b=2" } }),
    "/json/:id": (request) => Response.json({ id: request.params.id }, { headers: { "x-request-id": request.params.id, "cache-control": "no-store", "x-content-type-options": "nosniff" } }),
  },
  fetch: (request) => new Response("plain", { headers: { "Content-Length": "5", "x-path": new URL(request.url).pathname, vary: "accept" } }),
});
for (const path of ["/routed/7", "/json/8", "/plain"]) {
  for (let turn = 0; turn < 2; turn++) {
    const response = await fetch(new URL(path, server.url), { headers: { "x-request-id": `turn-${turn}` } });
    const headers = [...response.headers].filter(([name]) => name !== "date");
    console.log(path, response.status, JSON.stringify(headers), await response.text());
  }
}
await server.stop(true);
