// Methods of `response.headers` whose header name is a parameter, inside async functions, a generator and a try block. The calls pass well-known names, other names, an invalid name and values that are not strings.
async function putLater(response, name, value) {
  await null;
  response.headers.set(name, value);
  await null;
  return response.headers.has(name);
}
async function putFirst(response, name, value) {
  response.headers.append(name, value);
  await null;
  response.headers.append(name, value);
}
function* putInSteps(response, name) {
  response.headers.set(name, yield "first");
  response.headers.append(name, yield "second");
}
function putInTry(response, name, value) {
  try {
    response.headers.set(name, value);
    return "set";
  } catch (error) {
    return error.name;
  } finally {
    response.headers.delete("x-other");
  }
}
const names = ["cache-control", "authorization", "x-request-id", "vary", "etag", "location", "x-mine"];
const list = (response) => JSON.stringify([...response.headers]);
const a = new Response(null);
console.log(await putLater(a, "cache-control", "1"), await putLater(a, "authorization", "2"), await putLater(a, "x-request-id", "3"), await putLater(a, "vary", "4"), await putLater(a, "etag", "5"), await putLater(a, "location", "6"), await putLater(a, "x-mine", "7"), list(a));
const b = new Response(null);
await putFirst(b, "cache-control", "1");
await putFirst(b, "authorization", "2");
await putFirst(b, "x-request-id", "3");
await putFirst(b, "vary", "4");
await putFirst(b, "etag", "5");
await putFirst(b, "x-mine", "7");
console.log(list(b));
const c = new Response(null);
for (const steps of [putInSteps(c, "cache-control"), putInSteps(c, "authorization"), putInSteps(c, "x-request-id"), putInSteps(c, "vary"), putInSteps(c, "etag"), putInSteps(c, "x-mine")]) console.log(steps.next().value, steps.next("one").value, steps.next("two").done);
console.log(list(c));
const d = new Response(null);
console.log(putInTry(d, "cache-control", "1"), putInTry(d, "authorization", "2"), putInTry(d, "x-request-id", "3"), putInTry(d, "vary", "bad\nvalue"), putInTry(d, "etag", "5"), putInTry(d, "bad name", "6"), putInTry(d, "x-mine", "7"), list(d));
for (const name of [...names, "VARY", "nope", 7, null]) {
  const e = new Response(null);
  console.log(String(name), await putLater(e, name, "v").catch((error) => error.name), putInTry(e, name, "w"), list(e));
}

const server = Bun.serve({
  port: 0,
  routes: {
    "/routed/:name": async (request) => {
      const response = Response.json({ id: 1 });
      await putLater(response, "cache-control", "no-store");
      await putFirst(response, request.params.name, "from the path");
      return response;
    },
  },
  fetch: () => new Response("not found", { status: 404 }),
});
for (const name of ["etag", "x-unheard-of"]) {
  const response = await fetch(new URL(`/routed/${name}`, server.url));
  console.log(JSON.stringify([...response.headers].filter(([header]) => header !== "date")), await response.text());
}
await server.stop(true);
