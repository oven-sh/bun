// Every member of the request that Bun.serve hands to a handler, read in the handler.
const codeOf = (error: any) => `${error?.name}`;
const server = Bun.serve({
  port: 0,
  routes: {
    "/routed/:id": async request => Response.json({ id: request.params.id, keys: Object.keys(request.params), cookie: request.cookies.get("a") ?? null, tag: Object.prototype.toString.call(request) }),
  },
  async fetch(request, server) {
    const url = new URL(request.url);
    switch (url.pathname) {
      case "/plain":
        return Response.json({ method: request.method, accept: request.headers.get("accept"), has: request.headers.has("x-a"), mode: request.mode, redirect: request.redirect, cache: request.cache, used: request.bodyUsed, body: request.body === null, keepalive: request.keepalive, tag: Object.prototype.toString.call(request), aborted: request.signal.aborted, ip: typeof server.requestIP(request)?.address });
      case "/text":
        return new Response((await request.text()) + request.bodyUsed);
      case "/json":
        return Response.json(await request.json().catch(codeOf));
      case "/bytes":
        return new Response(String((await request.bytes()).length));
      case "/buffer":
        return new Response(String((await request.arrayBuffer()).byteLength));
      case "/blob":
        return new Response(String((await request.blob()).size));
      case "/form":
        return new Response(String((await request.formData().then(form => form.get("a"), codeOf))));
      case "/twice":
        await request.text();
        return new Response(await request.text().catch(codeOf));
      case "/clone":
        return new Response((await request.clone().text()) + (await request.text()));
      case "/headers":
        return Response.json([...request.headers].filter(([name]) => name.startsWith("x-")));
      case "/stream": {
        let length = 0;
        for await (const chunk of request.body!) length += chunk.length;
        return new Response(String(length));
      }
    }
    return new Response("none", { status: 404 });
  },
});
async function show(path: string, init?: RequestInit) {
  const response = await fetch(new URL(path, server.url), init);
  console.log(path, response.status, await response.text());
}
await show("/plain", { headers: { accept: "text/a", "x-a": "1" } });
await show("/text", { method: "POST", body: "abc" });
await show("/json", { method: "POST", body: '{"a":[1]}' });
await show("/json", { method: "POST", body: "{" });
await show("/bytes", { method: "POST", body: "abc" });
await show("/buffer", { method: "POST", body: "abcd" });
await show("/blob", { method: "POST", body: "abcde" });
await show("/form", { method: "POST", body: new URLSearchParams({ a: "b" }) });
await show("/form", { method: "POST", body: "x", headers: { "content-type": "text/plain" } });
await show("/twice", { method: "POST", body: "abc" });
await show("/clone", { method: "POST", body: "abc" });
await show("/headers", { headers: { "x-b": "2", "x-a": "1" } });
await show("/stream", { method: "POST", body: "abcdef" });
await show("/routed/7", { headers: { cookie: "a=b" } });
await show("/none");
server.stop(true);
