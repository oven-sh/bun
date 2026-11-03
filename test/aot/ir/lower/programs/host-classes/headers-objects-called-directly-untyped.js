// RUN: lower
// OPTIONS: builtin-modules

// Methods of a Headers object whose header name is a constant, a parameter or a loop variable: on the result of `new Headers(..)` and of `x.headers`, on a subclass, on objects of other classes with methods of the same names, and on a Headers object whose method or prototype was replaced.
export function madeHere(type, id) {
  const headers = new Headers();
  headers.set("content-type", type);
  headers.append("x-request-id", id);
  headers.append("Set-Cookie", id);
  const had = headers.has("X-Request-Id");
  headers.delete("x-request-id");
  return [had, new Response("x", { headers })];
}
export function madeFromInit(init) {
  return new Headers(init).get("content-type");
}
export function returned(value) {
  const headers = new Headers({ accept: "*/*" });
  headers.set("x-mine", value);
  return headers;
}
export function byParameter(name, value) {
  const headers = new Headers();
  headers.set(name, value);
  return headers;
}
export function byVariable(names) {
  const headers = new Headers();
  for (const name of names) headers.set(name, "v");
  return headers;
}
export function nameThatIsNoToken(value) {
  const headers = new Headers();
  headers.set("bad name", value);
  return headers;
}
export function handedOnFirst(holder, take) {
  const headers = holder.headers;
  take(headers);
  headers.set("x-mine", "after");
  return headers;
}
export function joinedWithAnother(given, value) {
  const headers = given ?? new Headers();
  headers.set("x-joined", value);
  return [headers, headers.get("x-joined")];
}
export function computedValue(count) {
  const headers = new Headers();
  headers.append("x-count", String(count + 1));
  return headers;
}
class Louder extends Headers {
  set(name, value) {
    super.set(name, `${value}!`);
  }
}
export function ofAnotherClass(value) {
  const headers = new Louder();
  headers.set("x-mine", value);
  return headers;
}

const describe = (error) => (/^(Invalid header name|Header '|Not enough arguments|Cannot convert a symbol|from )/.test(error.message) ? `${error.name}: ${error.message}` : error.name);
const show = (value) => (value instanceof Headers ? JSON.stringify([[...value], value.getSetCookie()]) : value instanceof Response ? show(value.headers) : value instanceof Map ? `Map ${JSON.stringify([...value])}` : Array.isArray(value) ? value.map(show).join(" . ") : String(value));
function attempt(run) {
  try {
    return show(run());
  } catch (error) {
    return describe(error);
  }
}
const log = [];
const says = (label, text) => ({
  toString() {
    log.push(label);
    return text;
  },
});
const throws = (label) => ({
  toString() {
    log.push(label);
    throw new RangeError(`from ${label}`);
  },
});
const values = ["v", "", "  padded ", "two\nlines", "café", "€", 7, null, undefined, says("value", "said"), throws("value"), Symbol("s")];
for (const value of values) {
  log.length = 0;
  console.log(attempt(() => madeHere(value, "id")), "|", attempt(() => madeHere("a/b", value)), "|", attempt(() => returned(value)), "|", attempt(() => nameThatIsNoToken(value)), "|", attempt(() => ofAnotherClass(value)), "|", log.join(","));
}
for (const init of [undefined, {}, { "Content-Type": "a/b" }, [["content-type", "c/d"], ["CONTENT-TYPE", "e/f"]], new Headers({ "content-type": "g/h" }), new Map([["content-type", "of a Map"]]), null, 7, "text", { "bad name": "v" }]) console.log(attempt(() => madeFromInit(init)));
for (const name of ["content-type", "CONTENT-TYPE", "x-mine", "cache-control", "bad name", "", "café", 7, null, undefined, says("name", "x-said"), Symbol("s")]) console.log(attempt(() => byParameter(name, "v")), "|", attempt(() => byVariable([name, "x-second"])));
console.log(attempt(() => byParameter("cache-control", "no-store")), attempt(() => byParameter("x-request-id", "7")), attempt(() => byParameter("Vary", "accept")));
console.log(attempt(() => computedValue(1)), attempt(() => computedValue("1")));

console.log("== handed on first");
for (const make of [() => new Response("", { headers: { accept: "*/*" } }), () => new Request("http://localhost/"), () => ({ headers: new Headers() }), () => ({ headers: new Map() }), () => ({ headers: new Louder() }), () => ({})]) {
  const holder = make();
  const seen = [];
  const result = attempt(() => handedOnFirst(holder, (headers) => seen.push(headers)));
  console.log(result, seen[0] === holder.headers, attempt(() => holder.headers));
  console.log(
    attempt(() =>
      handedOnFirst(make(), (headers) => {
        headers.set = (name, value) => log.push(`own set of ${name} to ${value}`);
      }),
    ),
    log.pop(),
  );
  console.log(attempt(() => handedOnFirst(make(), (headers) => Object.setPrototypeOf(headers, { set: (name, value) => log.push(`another prototype's set of ${name} to ${value}`) })) === undefined), log.pop());
}

console.log("== joined with another");
for (const given of [undefined, null, new Headers({ "x-given": "yes" }), new Map(), new Louder(), new Response("").headers, new URLSearchParams("x-joined=before"), new FormData()]) console.log(attempt(() => joinedWithAnother(given, "joined")));

console.log("== in a server");
const answer = (request) => {
  const [had, response] = madeHere("text/made", request.headers.get("x-sent"));
  const more = returned(String(had));
  handedOnFirst(response, (headers) => headers.append("x-handed", more.get("x-mine")));
  return response;
};
const server = Bun.serve({ port: 0, routes: { "/routed/:id": answer }, fetch: answer });
for (const path of ["/routed/1", "/plain"]) {
  for (let turn = 0; turn < 2; turn++) {
    const response = await fetch(new URL(path, server.url), { headers: { "x-sent": `turn-${turn}` } });
    console.log(path, JSON.stringify([...response.headers].filter(([name]) => name !== "date")), await response.text());
  }
}
await server.stop(true);

// GENERATED: byVariable attempt Louder set
// CHECK-LABEL: function {{*}}name="byVariable"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|string|Array<undefined|null|string> flags=[IsExpected]}] results=[{type=undefined|null|Headers flags=[IsExpected]}] {
// CHECK-NEXT: b0(v0: undefined|null|string|Array<undefined|null|string>):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Builtin builtin=GlobalThis
// CHECK-NEXT: v2 = PropGet v1 key="Headers" [isFreeName]
// CHECK-NEXT: v3 = Convert v2 declared={type=builtin(Headers) flags=[IsExpected]}
// CHECK-NEXT: v4 = Construct v3 calleeName="Headers"
// CHECK-NEXT: v5 = Convert v4 declared={type=undefined|null|Headers flags=[IsExpected]}
// CHECK-NEXT: v6 = IteratorOpen v0
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: b2():
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v8 = IteratorResume v6
// CHECK-NEXT: v9 = ResultAt v8
// CHECK-NEXT: v10 = ResultAt v8 index=1
// CHECK-NEXT: Branch v9 -> taken b3(), notTaken b4()
// CHECK-NEXT: b3():
// CHECK-NEXT: Return v5
// CHECK-NEXT: b4():
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5() handler=b6():
// CHECK-NEXT: v11 = Convert v10 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v12 = PropGet v5 key="set"
// CHECK-NEXT: v13 = Convert v12 declared={type=undefined|null|[[f_1]] flags=[IsExpected]}
// CHECK-NEXT: v14 = String string="v"
// CHECK-NEXT: v15 = Call v13, v5, v11, v14 calleeKey="set" calleeName="headers.set"
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: b6() role=IterationCleanup subject=v6:
// CHECK-NEXT: v16 = CatchException
// CHECK-NEXT: IteratorClose v6 completion=Throw
// CHECK-NEXT: Rethrow v16
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="attempt"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|function flags=[IsExpected]}] results=[{type=undefined|null|string flags=[IsExpected]}] {
// CHECK-NEXT: b0(v0: undefined|null|function):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: b2() handler=b3():
// CHECK-NEXT: v1 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v2 = CheckInitialized v1 name="show"
// CHECK-NEXT: v3 = Call v0 calleeName="run"
// CHECK-NEXT: v4 = Convert v3 declared={type=undefined|null|Array|Headers|Map|Response flags=[IsExpected]}
// CHECK-NEXT: v5 = Call v2, -, v4 calleeName="show"
// CHECK-NEXT: v6 = Convert v5 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: Return v6
// CHECK-NEXT: b3() role=CatchHandler:
// CHECK-NEXT: v7 = CatchValue
// CHECK-NEXT: v8 = GetModuleVariable variable=[[g_3]]
// CHECK-NEXT: v9 = CheckInitialized v8 name="describe"
// CHECK-NEXT: v10 = Call v9, -, v7 calleeName="describe"
// CHECK-NEXT: ReturnCall v10 casts=[{declared={type=undefined|null|string flags=[IsExpected]}}]
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Louder"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=DerivedConstructor flags=[HasRestParameter, HasNewTarget, TakesCallee, HasExplicitName] thisType={type=anything} parameters=[{type=Array flags=[IsFromCompiler]}] results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: function, v1: anything, v2: Array):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = GetSuperBase v0
// CHECK-NEXT: v4 = SuperConstructList v3, v1, v2 layout=[[L_4]]
// CHECK-NEXT: v5 = Convert v4 declared={type=[[L_4]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="set"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasThis, HasExplicitName] length=2 thisType={type=[[L_4]] flags=[IsExpected]} parameters=[{type=undefined|null|string flags=[IsExpected]}, {type=anything}] results=[{type=anything}] functionTypes={{*}}[[f_5]]] {
// CHECK-NEXT: b0(v0: [[L_4]], v1: undefined|null|string, v2: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = GetModuleVariable variable=[[g_6]]
// CHECK-NEXT: v4 = GetSuperBase v3 homeKind=ClassPrototype
// CHECK-NEXT: v5 = SuperGet v4, v0 key="set"
// CHECK-NEXT: v6 = ToString v2
// CHECK-NEXT: v7 = String string="!"
// CHECK-NEXT: v8 = Strcat v6, v7
// CHECK-NEXT: v9 = Call v5, v0, v1, v8 calleeName="super.set"
// CHECK-NEXT: v10 = Undefined
// CHECK-NEXT: Return v10
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="set"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow length=2 thisType={type=anything} parameters=[{type=anything}, {type=anything}] results=[{type=number flags=[IsExpected]}] functionTypes={{*}}[[f_7]]] {
// CHECK-NEXT: b0(v0: anything, v1: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = GetModuleVariable variable=[[g_8]]
// CHECK-NEXT: v3 = CheckInitialized v2 name="log"
// CHECK-NEXT: v4 = PropGet v3 key="push"
// CHECK-NEXT: v5 = Convert v4 declared={type=undefined|null|[[f_9]] flags=[IsExpected]}
// CHECK-NEXT: v6 = String string="another prototype's set of "
// CHECK-NEXT: v7 = ToString v0
// CHECK-NEXT: v8 = String string=" to "
// CHECK-NEXT: v9 = ToString v1
// CHECK-NEXT: v10 = Strcat v6, v7, v8, v9
// CHECK-NEXT: v11 = Call v5, v3, v10 calleeKey="push" calleeName="log.push"
// CHECK-NEXT: ReturnCall v11 casts=[{declared={type=number flags=[IsExpected]}}]
// CHECK-NEXT: }
