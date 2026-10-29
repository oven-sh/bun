// A server whose static route makes a Response before the first routed request: the request of a route is not a Response, though both are handed to `new Response(x.body, x)`.
const echo = (request: Request) => new Response(request.body, request);
const copy = () => {
  const first = new Response("copied", { status: 201, headers: { "x-a": "1" } });
  return new Response(first.body, first);
};
const server = Bun.serve({
  port: 0,
  routes: {
    "/health": new Response("ok"),
    "/echo": { POST: echo },
    "/copy": copy,
  },
  fetch: (request) => (new URL(request.url).pathname === "/plain" ? echo(request) : new Response("no route", { status: 404 })),
});

async function show(label: string, response: Response) {
  console.log(label, response.status, response.headers.get("x-a"), response.headers.get("x-b"), JSON.stringify(await response.text()));
}
const send = (path: string, body: string) => fetch(new URL(path, server.url), { method: "POST", body, headers: { "x-b": "2" } });

await show("static", await fetch(new URL("/health", server.url)));
await show("copy before a routed request is echoed", await fetch(new URL("/copy", server.url)));
await show("a routed request", await send("/echo", "sent"));
await show("a request without a route", await send("/plain", "sent plainly"));
await show("copy after", await fetch(new URL("/copy", server.url)));
for (let i = 0; i < 50; i++) {
  const [routed, plain, copied] = await Promise.all([send("/echo", "a" + i), send("/plain", "b" + i), fetch(new URL("/copy", server.url))]);
  const texts = [await routed.text(), await plain.text(), await copied.text()].join();
  if (texts !== `a${i},b${i},copied` || routed.headers.get("x-b") !== "2" || copied.status !== 201) console.log("differs at", i, texts);
}
await show("no route", await fetch(new URL("/none", server.url)));
await server.stop(true);
console.log("done");
