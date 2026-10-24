// Text evaluated at run time reads the getters of the host's objects again and again: those whose answer the object keeps (url, headers, signal, body) and those that are computed each time.
// The same object twice, other objects of the class, objects of a subclass, an object with a property of its own under the name, a getter replaced on the prototype, a receiver of another class.
const lines = [];
function show(name, run, turns = 6) {
  const seen = [];
  for (let turn = 0; turn < turns; turn++) {
    try {
      seen.push(JSON.stringify(run(turn)) ?? "undefined");
    } catch (error) {
      seen.push(error.constructor.name);
    }
  }
  lines.push(name + ": " + [...new Set(seen)].join(" | "));
}
const make = (parameters, text) => new Function(...parameters, text);
const at = "http://example.com/a/b?c=";

const readUrl = make(["r"], "return r.url;");
const readTwice = make(["r"], "const u = r.url, v = r.url; return [u, u === v];");
const readMany = make(["r"], "return [r.url, r.method, r.headers === r.headers, r.signal === r.signal, typeof r.body, r.bodyUsed, r.redirect, r.keepalive, r.mode, r.cache];");
show("url of a fresh request", turn => readUrl(new Request(at + turn)));
show("url twice", turn => readTwice(new Request(at + turn)));
const kept = new Request(at + "kept", { method: "POST", body: "text", headers: { a: "1" } });
show("url of the same request", () => readUrl(kept));
show("ten getters", turn => readMany(new Request(at + turn, { method: turn & 1 ? "POST" : "PUT", body: "b" })));
show("ten getters of the same request", () => readMany(kept));
show("headers are kept and can be changed", (() => {
  const read = make(["r", "i"], "r.headers.set('x', String(i)); return [r.headers.get('x'), r.headers.get('a')];");
  return turn => read(kept, turn);
})());
show("a clone has its own", (() => {
  const read = make(["r"], "const c = r.clone(); return [c.url === r.url, c.headers === r.headers, c.headers.get('a')];");
  return () => read(kept);
})());
show("a subclass", (() => {
  class Mine extends Request { get extra() { return "extra " + this.url; } }
  const read = make(["r"], "return [r.url, r.extra, r.method];");
  return turn => read(new Mine(at + turn));
})());
show("a subclass that overrides the getter", (() => {
  class Mine extends Request { get url() { return "mine " + super.url; } }
  return turn => [readUrl(new Mine(at + turn)), readUrl(new Request(at + turn))];
})());
show("a property of its own under the name", turn => {
  const request = new Request(at + turn);
  const before = readUrl(request);
  Object.defineProperty(request, "url", { value: "own " + turn, configurable: true });
  const own = readUrl(request);
  delete request.url;
  return [before, own, readUrl(request)];
});
show("requests, responses and plain objects at one place", turn => readUrl([new Request(at + turn), new Response("x"), { url: "plain " + turn }, Response.redirect(at + turn)][turn % 4]));
show("the getter on another receiver", (() => {
  const read = make(["r"], "return Object.create(r).url;");
  return turn => read(new Request(at + turn));
})());
show("response", (() => {
  const read = make(["r"], "return [r.status, r.ok, r.statusText, r.headers === r.headers, r.headers.get('content-type'), r.url, r.type, r.redirected, r.bodyUsed, r.body === r.body];");
  return turn => read(new Response("body " + turn, { status: 200 + turn, headers: { "content-type": "text/x" + turn } }));
})());
show("blob, file and url", (() => {
  const read = make(["b", "u"], "return [b.size, b.type, u.href, u.pathname, u.searchParams === u.searchParams, u.searchParams.get('c')];");
  return turn => read(new Blob(["x".repeat(turn)], { type: "text/t" + turn }), new URL(at + turn));
})());
show("an abort signal that changes", (() => {
  const read = make(["s"], "return [s.aborted, s.reason === undefined];");
  return turn => { const controller = new AbortController(); const before = read(controller.signal); controller.abort("why"); return [before, read(controller.signal)]; };
})());
show("the getter is replaced on the prototype and put back", (() => {
  const original = Object.getOwnPropertyDescriptor(Response.prototype, "statusText");
  const read = make(["r"], "return r.statusText;");
  return turn => {
    const response = new Response("", { statusText: "text " + turn });
    const before = read(response);
    let during = "not replaced";
    try {
      Object.defineProperty(Response.prototype, "statusText", { get() { return "replaced"; }, configurable: true });
      during = read(response);
    } catch (error) {
      during = error.constructor.name;
    } finally {
      try { Object.defineProperty(Response.prototype, "statusText", original); } catch {}
    }
    return [before, during, read(response)];
  };
})());
console.log(lines.join("\n"));
