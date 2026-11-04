// RUN: lower
// OPTIONS: builtin-modules

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

// GENERATED: describe change /route/:id
// CHECK-LABEL: function {{*}}name="describe"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|Request flags=[IsExpected, OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: undefined|null|Request):
// CHECK-NEXT: v1 = PropGet v0 key="url"
// CHECK-NEXT: v2 = PropGet v0 key="url"
// CHECK-NEXT: v3 = PropGet v0 key="headers"
// CHECK-NEXT: v4 = GetModuleVariable variable=[[g_1]]
// CHECK-NEXT: v5 = CheckInitialized v4 name="tidy"
// CHECK-NEXT: v6 = Call v5, -, v1 calleeName="tidy"
// CHECK-NEXT: v7 = StrictEq v1, v2
// CHECK-NEXT: v8 = PropGet v0 key="method"
// CHECK-NEXT: v9 = PropGet v0 key="headers"
// CHECK-NEXT: v10 = StrictEq v3, v9
// CHECK-NEXT: v11 = PropGet v0 key="headers"
// CHECK-NEXT: v12 = PropGet v11 key="get"
// CHECK-NEXT: v13 = String string="x-one"
// CHECK-NEXT: v14 = Call v12, v11, v13 calleeKey="get" calleeName="request.headers.get"
// CHECK-NEXT: v15 = Convert v14 declared={type=undefined|null|string flags=[OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v16 = PropGet v0 key="signal"
// CHECK-NEXT: v17 = PropGet v0 key="signal"
// CHECK-NEXT: v18 = StrictEq v16, v17
// CHECK-NEXT: v19 = PropGet v0 key="body"
// CHECK-NEXT: v20 = PropGet v0 key="body"
// CHECK-NEXT: v21 = StrictEq v19, v20
// CHECK-NEXT: v22 = NewArray v6, v7, v8, v10, v15, v18, v21 contents=anything
// CHECK-NEXT: v23 = PropGet v22 key="join"
// CHECK-NEXT: v24 = String string=" "
// CHECK-NEXT: v25 = Call v23, v22, v24 calleeKey="join" calleeName="join"
// CHECK-NEXT: ReturnCall v25 casts=[{declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}}, {declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}}]
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="change"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[f_2]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: undefined|null|[[f_2]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1() handler=b2():
// CHECK-NEXT: v1 = Call v0 calleeName="work"
// CHECK-NEXT: v2 = String string=""
// CHECK-NEXT: v3 = Convert v2 declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v3
// CHECK-NEXT: b2() role=CatchHandler:
// CHECK-NEXT: v4 = CatchValue
// CHECK-NEXT: v5 = String string="refused: "
// CHECK-NEXT: v6 = Convert v4 declared={type=undefined|null|Error flags=[IsExpected, OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v7 = PropGet v6 key="message"
// CHECK-NEXT: v8 = Add v5, v7
// CHECK-NEXT: v9 = String string=" | "
// CHECK-NEXT: v10 = Add v8, v9
// CHECK-NEXT: v11 = Convert v10 declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v11
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="/route/:id"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsChecked] length=1 thisType={type=anything} parameters=[{type=undefined|null|BunRequest flags=[IsExpected, OmitsNull, OmitsUndefined]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|BunRequest):
// CHECK-NEXT: v1 = Builtin builtin=GlobalThis
// CHECK-NEXT: v2 = PropGet v1 key="Response" [isFreeName]
// CHECK-NEXT: v3 = Convert v2 declared={type=builtin(Response) flags=[IsExpected]}
// CHECK-NEXT: v4 = GetModuleVariable variable=[[g_3]]
// CHECK-NEXT: v5 = Call v4, -, v0 calleeName="describeRoute"
// CHECK-NEXT: v6 = Construct v3, -, v5 calleeName="Response"
// CHECK-NEXT: v7 = Convert v6 declared={type=undefined|null|Response flags=[IsExpected, OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v7
// CHECK-NEXT: }
