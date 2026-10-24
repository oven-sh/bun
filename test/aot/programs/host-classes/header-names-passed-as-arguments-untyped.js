// set, get and has on `x.headers` whose header name is a parameter of a method. The calls pass well-known names, other names, names created at run time, invalid names and values that are not strings, also in a server.
class Context {
  constructor(response, request) {
    this.response = response;
    this.request = request;
  }
  header(name, value) {
    this.response.headers.set(name, value);
  }
  readHeader(name) {
    return this.request.headers.get(name);
  }
  neverGivenAConstant(name) {
    return this.response.headers.has(name);
  }
}
function forward(context, name, value) {
  context.header(name, value);
}

const list = (holder) => JSON.stringify([...holder.headers]);
function attempt(run) {
  try {
    return run();
  } catch (error) {
    return `${error.name}: ${error.message}`;
  }
}
const fresh = () => new Context(new Response(null), new Request("http://localhost/", { headers: { authorization: "Bearer 1", "x-request-id": "r1", "X-Other": "other" } }));

const context = fresh();
context.header("cache-control", "no-store");
context.header("x-request-id", "seven");
forward(context, "X-Content-Type-Options", "nosniff");
console.log(list(context.response));
console.log(context.readHeader("authorization"), context.readHeader("x-request-id"));

const made = ["cache", "control"].join("-");
const names = [made, "CACHE-CONTROL", "x-request-id".toUpperCase(), "x-content-type-options", "x-new", "content-type", "bad name", "", 7, null, { toString: () => "x-said" }];
for (const name of names) {
  const other = fresh();
  console.log(JSON.stringify(String(name)), String(attempt(() => other.header(name, "v"))), list(other.response), String(attempt(() => other.readHeader(name))), String(attempt(() => other.neverGivenAConstant(name))));
}
for (const value of ["two\nlines", " padded ", 7, Symbol("s")]) {
  const other = fresh();
  console.log(String(attempt(() => other.header("cache-control", value))), String(attempt(() => other.header("x-request-id", value))), list(other.response));
}

const server = Bun.serve({
  port: 0,
  routes: {
    "/routed": (request) => {
      const routed = new Context(Response.json({ id: 1 }), request);
      routed.header("x-request-id", routed.readHeader("x-request-id") ?? "none");
      routed.header("cache-control", routed.readHeader("authorization") ? "private" : "no-store");
      return routed.response;
    },
  },
  fetch: () => new Response("not found", { status: 404 }),
});
for (const headers of [{ "x-request-id": "sent", authorization: "Bearer 2" }, {}]) {
  const response = await fetch(new URL("/routed", server.url), { headers });
  console.log(JSON.stringify([...response.headers].filter(([name]) => name !== "date")), await response.text());
}
await server.stop(true);
