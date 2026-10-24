// Untyped code, as a framework writes it: the request stands in a field of a wrapper, and the name is a parameter.
class Wrapper {
  raw;
  constructor(raw) {
    this.raw = raw;
  }
  header(name) {
    if (name) return this.raw.headers.get(name) ?? undefined;
    return Object.fromEntries(this.raw.headers);
  }
}
function constantName(request) {
  return request.headers.get("x-a");
}
function keptHeaders(request) {
  const headers = request.headers;
  return [headers.get("x-a"), headers === request.headers];
}
export function twoArguments(request) {
  return request.headers.get("x-a", "x-b");
}
export function noArgument(request) {
  return request.headers.get();
}
export function nameRunsCode(request, log) {
  return request.headers.get(log.push("name") && "x-a");
}
function nameAfter(depth) {
  return depth > 0 ? nameAfter(depth - 1) : "x-a";
}
export function nameByCall(request) {
  return request.headers.get(nameAfter(3));
}
export async function nameByAwait(request) {
  return request.headers.get(await Promise.resolve("x-a"));
}
export function* nameByYield(request) {
  return request.headers.get(yield "which");
}
const candidates = ["accept", "host", "x-a", "x-b"];
function firstOfOurs(names) {
  let found = "";
  for (let round = 0; round < 2; round++) {
    for (const name of names) {
      try {
        if (!found && name.startsWith("x-")) found = name;
      } catch {
        found = "";
      }
    }
  }
  return found;
}
export function headersThenCall(request) {
  const headers = request.headers;
  const name = firstOfOurs(candidates);
  return headers.get(name);
}
export async function headersThenAwait(request) {
  const headers = request.headers;
  const name = await Promise.resolve("x-a");
  return headers.get(name);
}
function attempt(run) {
  try {
    return run();
  } catch (error) {
    return `${error.name}: ${error.message}`;
  }
}
const nameOfError = (run) => String(attempt(run)).split(":")[0];
function rowsOf(request) {
  const wrapper = new Wrapper(request);
  const log = [];
  return [
    wrapper.header("x-a"),
    wrapper.header("X-A"),
    wrapper.header("x-absent"),
    wrapper.header("x-twice"),
    constantName(request),
    twoArguments(request),
    attempt(() => noArgument(request)),
    nameRunsCode(request, log),
    log,
    keptHeaders(request),
    constantName(request),
    Object.keys(wrapper.header()).filter((name) => name.startsWith("x-")),
  ];
}

const server = Bun.serve({
  port: 0,
  routes: { "/routed": (request) => Response.json(rowsOf(request)) },
  fetch: async (request) => {
    const before = new Wrapper(request).header("x-a");
    await null;
    return Response.json([before, rowsOf(request)]);
  },
});
for (const path of ["/routed", "/plain", "/routed", "/plain"]) {
  const headers = new Headers({ "x-a": "1" });
  headers.append("x-twice", "a");
  headers.append("x-twice", "b");
  console.log(path, await (await fetch(new URL(path, server.url), { headers })).text());
}
await server.stop(true);

const looksLikeOne = { headers: { get: (name) => `looks like ${name}` } };
const getter = {
  reads: 0,
  get headers() {
    this.reads++;
    return new Map([["x-a", "from a getter"]]);
  },
};
console.log(
  JSON.stringify([
    constantName(looksLikeOne),
    new Wrapper(looksLikeOne).header("x-a"),
    constantName(getter),
    getter.reads,
    constantName(new Response("", { headers: { "x-a": "response" } })),
    constantName(new Request("http://localhost/", { headers: { "x-a": "made" } })),
    nameByCall(new Request("http://localhost/", { headers: { "x-a": "by a call" } })),
    await nameByAwait(new Request("http://localhost/", { headers: { "x-a": "by an await" } })),
    headersThenCall(new Request("http://localhost/", { headers: { "x-a": "headers, then a call" } })),
    await headersThenAwait(new Request("http://localhost/", { headers: { "x-a": "headers, then an await" } })),
    ((generator) => [generator.next().value, generator.next("x-a").value])(nameByYield(new Request("http://localhost/", { headers: { "x-a": "by a yield" } }))),
    nameOfError(() => constantName(undefined)),
    nameOfError(() => constantName({ headers: null })),
    nameOfError(() => constantName({ headers: {} })),
    nameOfError(() => constantName(1)),
    nameOfError(() => constantName("text")),
  ]),
);
