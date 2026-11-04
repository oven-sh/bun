// RUN: lower
// OPTIONS: builtin-modules

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

// GENERATED: attempt Context readHeader list fresh
// CHECK-LABEL: function {{*}}name="attempt"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|function flags=[IsExpected]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|function):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1() handler=b2():
// CHECK-NEXT: v1 = Call v0 calleeName="run"
// CHECK-NEXT: Return v1
// CHECK-NEXT: b2() role=CatchHandler:
// CHECK-NEXT: v2 = CatchValue
// CHECK-NEXT: v3 = PropGet v2 key="name"
// CHECK-NEXT: v4 = ToString v3
// CHECK-NEXT: v5 = String string=": "
// CHECK-NEXT: v6 = PropGet v2 key="message"
// CHECK-NEXT: v7 = ToString v6
// CHECK-NEXT: v8 = Strcat v4, v5, v7
// CHECK-NEXT: Return v8
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Context"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, HasExplicitName] length=2 thisType={type=anything} parameters=[{type=anything}, {type=anything}] results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: anything, v1: anything, v2: anything):
// CHECK-NEXT: v3 = GetConstructPrototype v0 layout=[[L_1]]
// CHECK-NEXT: v4 = NewObject v3 layout=[[L_1]]
// CHECK-NEXT: v5 = Convert v4 declared={type=[[L_1]]}
// CHECK-NEXT: PropSet v5, v1 key="response"
// CHECK-NEXT: PropSet v5, v2 key="request"
// CHECK-NEXT: v8 = Undefined
// CHECK-NEXT: v9 = TypeTest v8 testedType=object
// CHECK-NEXT: Branch v9 -> taken b1(| 0), notTaken b2(v5)
// CHECK-NEXT: b1(v10):
// CHECK-NEXT: Jump -> next b2(v10)
// CHECK-NEXT: b2(v11):
// CHECK-NEXT: Return v11
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="readHeader"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasThis, HasExplicitName] length=1 thisType={type=[[L_1]] flags=[IsExpected]} parameters=[{type=anything}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: [[L_1]], v1: anything):
// CHECK-NEXT: v2 = PropGet v0 key="request"
// CHECK-NEXT: v3 = PropGet v2 key="headers"
// CHECK-NEXT: v4 = PropGet v3 key="get"
// CHECK-NEXT: v5 = Call v4, v3, v1 calleeKey="get" calleeName="this.request.headers.get"
// CHECK-NEXT: ReturnCall v5
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="list"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow length=1 thisType={type=anything} parameters=[{type=undefined|null|[[L_2]] flags=[IsExpected]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_2]]):
// CHECK-NEXT: v1 = Builtin builtin=JSON
// CHECK-NEXT: v2 = PropGet v1 key="stringify"
// CHECK-NEXT: v3 = Convert v2 declared={type=builtin(JSONStringify) flags=[IsExpected]}
// CHECK-NEXT: v4 = NewArray contents=anything
// CHECK-NEXT: v5 = PropGet v0 key="headers"
// CHECK-NEXT: AppendSpread v4, v5
// CHECK-NEXT: v7 = Call v3, v1, v4 calleeKey="stringify" calleeName="JSON.stringify"
// CHECK-NEXT: ReturnCall v7
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="fresh"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: v0 = GetModuleVariable variable=[[g_3]]
// CHECK-NEXT: v1 = CheckInitialized v0 name="Context"
// CHECK-NEXT: v2 = Builtin builtin=GlobalThis
// CHECK-NEXT: v3 = PropGet v2 key="Response" [isFreeName]
// CHECK-NEXT: v4 = Convert v3 declared={type=builtin(Response) flags=[IsExpected]}
// CHECK-NEXT: v5 = Null
// CHECK-NEXT: v6 = Construct v4, -, v5 calleeName="Response"
// CHECK-NEXT: v7 = Builtin builtin=GlobalThis
// CHECK-NEXT: v8 = PropGet v7 key="Request" [isFreeName]
// CHECK-NEXT: v9 = Convert v8 declared={type=builtin(Request) flags=[IsExpected]}
// CHECK-NEXT: v10 = String string="http://localhost/"
// CHECK-NEXT: v11 = Data data=[[d_4]]
// CHECK-NEXT: v12 = Construct v9, -, v10, v11 calleeName="Request"
// CHECK-NEXT: v13 = Construct v1, -, v6, v12 calleeName="Context"
// CHECK-NEXT: Return v13
// CHECK-NEXT: }
