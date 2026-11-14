const churn = () => { let a = []; for (let i = 0; i < 300; i++) a.push({ i, s: "s" + i, l: [i] }); return a.length; };
class U extends URL { constructor(path, base) { super(path, base); } }
class Ag extends AggregateError { constructor(errors, message, options) { super(errors, message, options); } }
class F extends File { constructor(parts, name, options) { super(parts, name, options); } }
class D extends Date { constructor(...a) { super(...a); } }
class D7 extends Date { constructor(y, m, d, h, mi, s, ms) { super(y, m, d, h, mi, s, ms); } }
class A extends Array { constructor(a, b, c, d, e, f, g, h) { super(a, b, c, d, e, f, g, h); } }
class B extends Uint8Array { constructor(buffer, offset, length) { super(buffer, offset, length); } }
class R extends RegExp { constructor(source, flags) { super(source, flags); } }
class E extends Error { constructor(message, options) { super(message, options); } }
class P extends Promise { constructor(executor, unused) { super(executor, unused); } }
class Ev extends Event { constructor(type, init) { super(type, init); } }
class Rq extends Request { constructor(url, init) { super(url, init); } }
class Rs extends Response { constructor(body, init) { super(body, init); } }
class DV extends DataView { constructor(b, o, l) { super(b, o, l); } }
class Odd extends Error { constructor(m, o) { super(...[m, o]); } }
const buffer = new ArrayBuffer(16);
new Uint8Array(buffer).set([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
const coerced = log => ({ toString() { log.push("string"); churn(); Bun.gc(true); return "from toString"; } });
for (let i = 0; i < 6; i++) {
  const last = i === 5, say = (...v) => last && console.log(...v);
  churn();
  say("url", new U("b?i=" + i, "http://a/c/").href);
  const ag = new Ag([new Error("e" + i), i], "m" + i, { cause: { i } });
  say("aggregate", ag.errors.length, ag.errors[0].message, ag.errors[1], ag.message, JSON.stringify(ag.cause));
  const f = new F(["a", "b" + i], "name" + i, { type: "text/plain", lastModified: i });
  say("file", f.size, f.name, f.type, f.lastModified);
  say("date", new D(2020, 1, 2, 3, 4, 5, 6).getTime() === new Date(2020, 1, 2, 3, 4, 5, 6).getTime(), new D7(2021, 2, 3, 4, 5, 6, 7).getMilliseconds(), new D7(2021, 2, 3, 4, 5, 6, 7).getHours());
  say("array", JSON.stringify(new A(1, "b", { c: 3 }, [4], null, undefined, 7.5, i)));
  say("bytes", [...new B(buffer, 2, 3)].join(), new DV(buffer, 4, 2).getUint8(1));
  say("regexp", String(new R("a(b)" + i, "gi")));
  const options = { get cause() { churn(); Bun.gc(true); return "cause" + i; } };
  const log = [];
  const e = new E(coerced(log), options);
  say("error", e.message, e.cause, log.join());
  const odd = new Odd("odd" + i, { cause: i });
  say("spread", odd.message, odd.cause);
  say("event", new Ev("t" + i, { cancelable: true }).cancelable, new Ev("t" + i, {}).type);
  const rq = new Rq("http://a/" + i, { method: "POST", headers: { x: "y" + i }, body: "q" });
  say("request", rq.url, rq.method, rq.headers.get("x"));
  const rs = new Rs("body" + i, { status: 201, headers: { z: "w" } });
  say("response", rs.status, rs.headers.get("z"));
  say("promise", new P(resolve => { churn(); Bun.gc(true); resolve(i); }, 1) instanceof P);
  say("absent", new E().message === "", new E("x").cause === undefined, "cause" in new E("x", {}), "cause" in new E("x", { cause: undefined }));
  for (const bad of [() => new (class extends null { constructor() { super(1); } })(), () => new (class extends Symbol { constructor() { super("a", "b"); } })(), () => new B(buffer, 99, 1), () => new R("(", "g"), () => new U("::", "also bad")])
    try { bad(); say("no error"); } catch (error) { say(error.constructor.name, error.message.slice(0, 60)); }
}
