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
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|Request flags=[IsExpected, OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|string site=[[w_1]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: undefined|null|Request):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = TypeTest v0 testedType=undefined|null
// CHECK-NEXT: Branch v1 -> taken b2(| 0), notTaken b4(| 0)
// CHECK-NEXT: b2(v2):
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3() frequency=Unlikely:
// CHECK-NEXT: v3 = NewRuntimeError runtimeError=NotDestructurable name="url"
// CHECK-NEXT: Throw v3
// CHECK-NEXT: b4(v4):
// CHECK-NEXT: v5 = PropGet v0 key="url"
// CHECK-NEXT: v6 = Convert v5 declared={type=undefined|null|string site=[[w_2]]} illTypedCause=Assertion
// CHECK-NEXT: v7 = PropGet v0 key="url"
// CHECK-NEXT: v8 = Convert v7 declared={type=undefined|null|string site=[[w_3]]} illTypedCause=Assertion
// CHECK-NEXT: v9 = PropGet v0 key="headers"
// CHECK-NEXT: v10 = Convert v9 declared={type=undefined|null|Headers flags=[IsExpected]}
// CHECK-NEXT: v11 = GetModuleVariable variable=[[g_4]]
// CHECK-NEXT: v12 = CheckInitialized v11 name="tidy"
// CHECK-NEXT: v13 = Call v12, -, v6 calleeName="tidy"
// CHECK-NEXT: v14 = Convert v13 declared={type=undefined|null|string site=[[w_5]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v15 = StrictEq v6, v8
// CHECK-NEXT: v16 = PropGet v0 key="method"
// CHECK-NEXT: v17 = Convert v16 declared={type=undefined|null|string site=[[w_6]]} illTypedCause=Assertion
// CHECK-NEXT: v18 = PropGet v0 key="headers"
// CHECK-NEXT: v19 = Convert v18 declared={type=undefined|null|Headers flags=[IsExpected]}
// CHECK-NEXT: v20 = StrictEq v10, v19
// CHECK-NEXT: v21 = PropGet v0 key="headers"
// CHECK-NEXT: v22 = Convert v21 declared={type=undefined|null|Headers flags=[IsExpected]}
// CHECK-NEXT: v23 = PropGet v22 key="get"
// CHECK-NEXT: v24 = String string="x-one"
// CHECK-NEXT: v25 = Call v23, v22, v24 calleeKey="get" calleeName="request.headers.get"
// CHECK-NEXT: v26 = Convert v25 declared={type=undefined|null|string site=[[w_7]] flags=[OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v27 = PropGet v0 key="signal"
// CHECK-NEXT: v28 = Convert v27 declared={type=undefined|null|AbortSignal flags=[IsExpected]}
// CHECK-NEXT: v29 = PropGet v0 key="signal"
// CHECK-NEXT: v30 = Convert v29 declared={type=undefined|null|AbortSignal flags=[IsExpected]}
// CHECK-NEXT: v31 = StrictEq v28, v30
// CHECK-NEXT: v32 = PropGet v0 key="body"
// CHECK-NEXT: v33 = Convert v32 declared={type=undefined|null|ReadableStream flags=[IsExpected]}
// CHECK-NEXT: v34 = PropGet v0 key="body"
// CHECK-NEXT: v35 = Convert v34 declared={type=undefined|null|ReadableStream flags=[IsExpected]}
// CHECK-NEXT: v36 = StrictEq v33, v35
// CHECK-NEXT: v37 = NewArray v14, v15, v17, v20, v26, v31, v36 contents=undefined|null|boolean|string
// CHECK-NEXT: v38 = PropGet v37 key="join"
// CHECK-NEXT: v39 = String string=" "
// CHECK-NEXT: v40 = Call v38, v37, v39 calleeKey="join" calleeName="join"
// CHECK-NEXT: ReturnCall v40 casts=[{declared={type=undefined|null|string site=[[w_8]] flags=[OmitsNull, OmitsUndefined]}}, {declared={type=undefined|null|string site=[[w_1]] flags=[OmitsNull, OmitsUndefined]}}]
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="change"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[f_9]] site=[[w_10]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|string site=[[w_11]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: undefined|null|[[f_9]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: b2() handler=b3():
// CHECK-NEXT: v1 = Call v0 calleeName="work"
// CHECK-NEXT: v2 = String string=""
// CHECK-NEXT: v3 = Convert v2 declared={type=undefined|null|string site=[[w_11]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v3
// CHECK-NEXT: b3() role=CatchHandler:
// CHECK-NEXT: v4 = CatchValue
// CHECK-NEXT: v5 = String string="refused: "
// CHECK-NEXT: v6 = Convert v4 declared={type=undefined|null|Error flags=[IsExpected, OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v7 = PropGet v6 key="message"
// CHECK-NEXT: v8 = Convert v7 declared={type=undefined|null|string site=[[w_12]]} illTypedCause=Assertion
// CHECK-NEXT: v9 = Add v5, v8
// CHECK-NEXT: v10 = String string=" | "
// CHECK-NEXT: v11 = Add v9, v10
// CHECK-NEXT: v12 = Convert v11 declared={type=undefined|null|string site=[[w_11]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v12
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="/route/:id"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsChecked] length=1 thisType={type=anything} parameters=[{type=undefined|null|BunRequest flags=[IsExpected, OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|Response flags=[IsExpected, OmitsNull, OmitsUndefined]}] functionTypes={{*}}[[f_13]]] {
// CHECK-NEXT: b0(v0: undefined|null|BunRequest):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Builtin builtin=GlobalThis
// CHECK-NEXT: v2 = PropGet v1 key="Response" [isFreeName]
// CHECK-NEXT: v3 = Convert v2 declared={type=builtin(Response) flags=[IsExpected]}
// CHECK-NEXT: v4 = GetModuleVariable variable=[[g_14]]
// CHECK-NEXT: v5 = Call v4, -, v0 calleeName="describeRoute"
// CHECK-NEXT: v6 = Convert v5 declared={type=undefined|null|string site=[[w_15]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v7 = Construct v3, -, v6 calleeName="Response"
// CHECK-NEXT: v8 = Convert v7 declared={type=undefined|null|Response flags=[IsExpected, OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v8
// CHECK-NEXT: }
