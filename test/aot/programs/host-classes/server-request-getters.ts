// The request that Bun.serve hands to `fetch` and to a route: its getters are read for the first time and again, behind own properties, and behind a property that the prototype of a route's requests has gained.
import type { BunRequest } from "bun";

const lines: string[] = [];
let port = 0;
const tidy = (value: unknown) => String(value).replace(":" + port + "/", ":PORT/");

function describe(request: Request): string {
  const first: unknown = request.url;
  const again: unknown = request.url;
  const headers: unknown = request.headers;
  return [tidy(first), first === again, request.method, headers === request.headers, request.headers.get("x-one"), request.signal === request.signal, request.body === request.body].join(" ");
}

function change(work: () => void): string {
  try {
    work();
    return "";
  } catch (error) {
    return "refused: " + (error as Error).message + " | ";
  }
}

function describeRoute(request: BunRequest<"/route/:id">): string {
  const first: unknown = request.url;
  const again: unknown = request.url;
  return [tidy(first), first === again, request.method, request.params.id, request.headers.get("x-one")].join(" ");
}

const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  routes: {
    "/route/:id": request => new Response(describeRoute(request)),
    "/shadow-the-prototype": request => {
      const refusal = change(() => Object.defineProperty(Object.getPrototypeOf(request), "url", { value: "of the prototype of a route's requests", configurable: true }));
      return new Response(refusal + describeRoute(request as unknown as BunRequest<"/route/:id">));
    },
    "/clear-the-prototype": request => {
      const refusal = change(() => delete Object.getPrototypeOf(request).url);
      return new Response(refusal + describeRoute(request as unknown as BunRequest<"/route/:id">));
    },
    "/shadow-the-method": request => {
      const refusal = change(() => Object.defineProperty(Object.getPrototypeOf(request), "method", { get: () => "SHADOWED", configurable: true }));
      return new Response(refusal + describeRoute(request as unknown as BunRequest<"/route/:id">));
    },
    "/clear-the-method": request => {
      const refusal = change(() => delete Object.getPrototypeOf(request).method);
      return new Response(refusal + describeRoute(request as unknown as BunRequest<"/route/:id">));
    },
    "/put-a-prototype-in-between": request => {
      const ofRoutes = Object.getPrototypeOf(request);
      const refusal = change(() =>
        Object.setPrototypeOf(
          ofRoutes,
          Object.create(Object.getPrototypeOf(ofRoutes), {
            url: { value: "of an object put in between", configurable: true },
            method: { value: "BETWEEN", configurable: true },
          }),
        ),
      );
      return new Response(refusal + describeRoute(request as unknown as BunRequest<"/route/:id">));
    },
    "/take-it-out-again": request => {
      const ofRoutes = Object.getPrototypeOf(request);
      const refusal = change(() => Object.setPrototypeOf(ofRoutes, Object.getPrototypeOf(ofRoutes) === Request.prototype ? Request.prototype : Object.getPrototypeOf(Object.getPrototypeOf(ofRoutes))));
      return new Response(refusal + describeRoute(request as unknown as BunRequest<"/route/:id">));
    },
  },
  fetch(request) {
    const path = new URL(request.url).pathname;
    if (path === "/own-before") {
      Object.defineProperty(request, "url", { value: "own, before a read" });
      Object.defineProperty(request, "headers", { value: new Headers({ "x-one": "own" }) });
    }
    if (path === "/own-after") {
      describe(request);
      Object.defineProperty(request, "url", { value: "own, after a read" });
      Object.defineProperty(request, "method", { value: "OWN" });
    }
    if (path === "/extra") (request as unknown as { extra: number }).extra = 1;
    if (path === "/frozen") Object.freeze(request);
    if (path === "/clone") return new Response(describe(request.clone()) + " | " + describe(request));
    return new Response(describe(request));
  },
});
port = server.port!;

for (let turn = 0; turn < 3; turn++) {
  for (const path of ["/plain?a=b", "/own-before", "/own-after", "/extra", "/frozen", "/clone", "/route/7", "/shadow-the-prototype", "/route/8", "/clear-the-prototype", "/route/9", "/shadow-the-method", "/route/10", "/clear-the-method", "/route/11", "/put-a-prototype-in-between", "/route/12", "/take-it-out-again", "/route/13", "/plain"]) {
    const response = await fetch(`http://127.0.0.1:${port}${path}`, { method: turn === 1 ? "POST" : "GET", headers: { "x-one": "1" }, body: turn === 1 ? "abc" : undefined });
    lines.push(turn + " " + path + ": " + response.status + " " + (await response.text()));
  }
}
await server.stop(true);
console.log(lines.join("\n"));
