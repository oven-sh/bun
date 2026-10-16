// A matrix of rows (value x options x entry point). One line per row: "<label> => <JSON text or THROWS name>".
const util = require("node:util");
const assert = require("node:assert");
const { Console } = require("node:console");
const { Writable } = require("node:stream");
const href = "http://example.com/a?k=v";
class MyURL extends URL {}
class Custom extends URL { get href() { return "custom:href"; } }
class NumberHref extends URL { get href() { return 42; } }
class EmptyHref extends URL { get href() { return ""; } }
class BrokenURL extends URL { get href() { throw new Error("url href"); } }
class Link { get href() { return "http://example.com/link"; } }
class Broken { get href() { throw new Error("boom"); } }
const values = {
  "URL": () => new URL(href),
  "URL subclass": () => new MyURL(href),
  "URL with an own property": () => Object.assign(new URL(href), { extra: 1 }),
  "URL subclass, href getter returns a string": () => new Custom(href),
  "URL subclass, href getter returns a number": () => new NumberHref(href),
  "URL subclass, href getter returns ''": () => new EmptyHref(href),
  "URL subclass, href getter throws": () => new BrokenURL(href),
  "URL with the hook shadowed": () => Object.defineProperty(new URL(href), util.inspect.custom, { value: undefined }),
  "Object.create(URL.prototype)": () => Object.create(URL.prototype),
  "prototype of a URL subclass": () => MyURL.prototype,
  "{ href, __proto__: URL.prototype }": () => ({ href: "x", __proto__: URL.prototype }),
  "class instance, href getter returns a string": () => new Link(),
  "class instance, href getter throws": () => new Broken(),
  "null-prototype object, href getter returns a string": () => Object.create(null, { href: { get() { return "np"; } } }),
  "null-prototype object, href getter throws": () => Object.create(null, { href: { get() { throw new Error("np"); } } }),
  "Proxy of a URL": () => new Proxy(new URL(href), {}),
  "Proxy of a Proxy of a URL": () => new Proxy(new Proxy(new URL(href), {}), {}),
  "{ a: URL }": () => ({ a: new URL(href) }),
  "[URL]": () => [new URL(href)],
  "{ a: { b: { c: URL } } }": () => ({ a: { b: { c: new URL(href) } } }),
  "{ a: class instance whose href getter throws }": () => ({ a: new Broken() }),
  "class extends URL": () => MyURL,
};
const raw = { customInspect: false };
const options = {
  "default": undefined,
  "depth 0": { depth: 0 },
  "raw": raw,
  "raw, depth 0": { ...raw, depth: 0 },
  "raw, showHidden": { ...raw, showHidden: true },
  "raw, showProxy": { ...raw, showProxy: true },
  "raw, getters": { ...raw, getters: true },
};
const rows = [];
const row = (label, f) => {
  let out;
  try { out = JSON.stringify(f()); } catch (e) { out = "THROWS " + (e && e.name === "AssertionError" ? "AssertionError " + JSON.stringify(String(e.message)) : e && e.name); }
  rows.push(label + " => " + out);
};
const dir = (value, opts) => { let text = ""; const c = new Console(new Writable({ write(chunk, _e, cb) { text += chunk; cb(); } })); c.dir(value, opts); return text; };
for (const [vname, make] of Object.entries(values)) {
  for (const [oname, opts] of Object.entries(options)) row(`inspect | ${vname} | ${oname}`, () => util.inspect(make(), opts));
  row(`format %o | ${vname}`, () => util.format("%o", make()));
  row(`format %O | ${vname}`, () => util.format("%O", make()));
  row(`format %s | ${vname}`, () => util.format("%s", make()));
  row(`Console#dir | ${vname}`, () => dir(make()));
  row(`assert.strictEqual(v, 1) | ${vname}`, () => assert.strictEqual(make(), 1));
  row(`assert.deepStrictEqual({a: v}, {a: 1}) | ${vname}`, () => assert.deepStrictEqual({ a: make() }, { a: 1 }));
  row(`assert.equal(v, 1) | ${vname}`, () => assert.equal(make(), 1));
  row(`assert.notStrictEqual(v, v) | ${vname}`, () => { const v = make(); assert.notStrictEqual(v, v); });
  Error.stackTraceLimit = 10;
}
console.log(rows.join("\n"));
