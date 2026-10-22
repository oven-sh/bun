// A program may pass many header names: over four, the length of the name picks the few constants it can be; up to 64 are taken, with more nothing is compared.
class Context {
  constructor(response) {
    this.response = response;
  }
  put(name, value) {
    this.response.headers.set(name, value);
  }
  flood(name, value) {
    this.response.headers.append(name, value);
  }
}
const list = (holder) => JSON.stringify([...holder.headers]);
function attempt(run) {
  try {
    return run();
  } catch (error) {
    return /^(Invalid header name|Header '|Cannot convert a symbol)/.test(error.message) ? `${error.name}: ${error.message}` : error.name;
  }
}
const context = new Context(new Response(null));
context.put("cache-control", "v0");
context.put("authorization", "v1");
context.put("x-request-id", "v2");
context.put("x-content-type-options", "v3");
context.put("Location", "v4");
context.put("vary", "v5");
context.put("etag", "v6");
context.put("x-frame-options", "v7");
context.put("content-language", "v8");
context.put("X-Powered-By", "v9");
context.put("retry-after", "v10");
context.put("x-mine", "v11");
console.log(list(context.response));
const flooded = new Context(new Response(null));
flooded.flood("x-flood-00", "f");
flooded.flood("x-flood-01", "f");
flooded.flood("x-flood-02", "f");
flooded.flood("x-flood-03", "f");
flooded.flood("x-flood-04", "f");
flooded.flood("x-flood-05", "f");
flooded.flood("x-flood-06", "f");
flooded.flood("x-flood-07", "f");
flooded.flood("x-flood-08", "f");
flooded.flood("x-flood-09", "f");
flooded.flood("x-flood-10", "f");
flooded.flood("x-flood-11", "f");
flooded.flood("x-flood-12", "f");
flooded.flood("x-flood-13", "f");
flooded.flood("x-flood-14", "f");
flooded.flood("x-flood-15", "f");
flooded.flood("x-flood-16", "f");
flooded.flood("x-flood-17", "f");
flooded.flood("x-flood-18", "f");
flooded.flood("x-flood-19", "f");
flooded.flood("x-flood-20", "f");
flooded.flood("x-flood-21", "f");
flooded.flood("x-flood-22", "f");
flooded.flood("x-flood-23", "f");
flooded.flood("x-flood-24", "f");
flooded.flood("x-flood-25", "f");
flooded.flood("x-flood-26", "f");
flooded.flood("x-flood-27", "f");
flooded.flood("x-flood-28", "f");
flooded.flood("x-flood-29", "f");
flooded.flood("x-flood-30", "f");
flooded.flood("x-flood-31", "f");
flooded.flood("x-flood-32", "f");
flooded.flood("x-flood-33", "f");
flooded.flood("x-flood-34", "f");
flooded.flood("x-flood-35", "f");
flooded.flood("x-flood-36", "f");
flooded.flood("x-flood-37", "f");
flooded.flood("x-flood-38", "f");
flooded.flood("x-flood-39", "f");
flooded.flood("x-flood-40", "f");
flooded.flood("x-flood-41", "f");
flooded.flood("x-flood-42", "f");
flooded.flood("x-flood-43", "f");
flooded.flood("x-flood-44", "f");
flooded.flood("x-flood-45", "f");
flooded.flood("x-flood-46", "f");
flooded.flood("x-flood-47", "f");
flooded.flood("x-flood-48", "f");
flooded.flood("x-flood-49", "f");
flooded.flood("x-flood-50", "f");
flooded.flood("x-flood-51", "f");
flooded.flood("x-flood-52", "f");
flooded.flood("x-flood-53", "f");
flooded.flood("x-flood-54", "f");
flooded.flood("x-flood-55", "f");
flooded.flood("x-flood-56", "f");
flooded.flood("x-flood-57", "f");
flooded.flood("x-flood-58", "f");
flooded.flood("x-flood-59", "f");
flooded.flood("x-flood-60", "f");
flooded.flood("x-flood-61", "f");
flooded.flood("x-flood-62", "f");
flooded.flood("x-flood-63", "f");
flooded.flood("x-flood-64", "f");
console.log([...flooded.response.headers].length);

const log = [];
const made = (text) => text.split("").join("");
const rope = (text) => text.slice(0, 3) + text.slice(3);
const others = ["cache-contro1", "CACHE-CONTROL", "Authorization", "location", "x-minE", "x-mine ", "", "v", "vary2", "x".repeat(13), "x".repeat(300), "bad name 1234", "caché-control", 7, 1234567890123, null, undefined, true, { toString: () => (log.push("asked"), "etag") }, ["vary"], Symbol("vary")];
for (const name of ["cache-control", "authorization", "x-request-id", "x-content-type-options", "Location", "vary", "etag", "x-frame-options", "content-language", "X-Powered-By", "retry-after", "x-mine"]) {
  const other = new Context(new Response(null));
  console.log(name, String(attempt(() => other.put(made(name), "made"))), String(attempt(() => other.put(rope(name), "rope"))), String(attempt(() => other.put(name.toUpperCase(), "upper"))), list(other.response));
}
for (const name of others) {
  const other = new Context(new Response(null, { headers: { etag: "before", vary: "before" } }));
  console.log(typeof name === "symbol" ? "symbol" : JSON.stringify(String(name).slice(0, 20)), String(attempt(() => other.put(name, "v"))), list(other.response), log.join(","));
}

const server = Bun.serve({
  port: 0,
  routes: {
    "/routed/:name": (request) => {
      const routed = new Context(Response.json({ id: 1 }));
      routed.put("cache-control", "no-store");
      routed.put("x-frame-options", "DENY");
      routed.put(request.params.name, "from the path");
      return routed.response;
    },
  },
  fetch: () => new Response("not found", { status: 404 }),
});
for (const name of ["etag", "x-unheard-of", "VARY"]) {
  const response = await fetch(new URL(`/routed/${name}`, server.url));
  console.log(JSON.stringify([...response.headers].filter(([header]) => header !== "date")), await response.text());
}
await server.stop(true);
