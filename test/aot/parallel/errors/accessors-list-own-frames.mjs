// What an accessor of the host that throws lists in the stack: none of its own where the store or the read is written, its function where that is called.
const names = error => error.stack.split("\n").slice(1).map(line => line.trim().replace(/^at /, "").replace(/ \(.*/, "").replace(/ unknown$/, "").replace(/.*\.mjs:\d+:\d+$/, "module"));
const ways = {
  href() { const url = new URL("http://a/"); url.href = "bad"; },
  hrefLoop() { const url = new URL("http://a/"); for (let i = 0; i < 5; i++) url.href = i < 4 ? "http://b/" + i : "bad"; },
  hrefAny(url = globalThis.held) { url.href = "bad"; },
  hrefKey(url = globalThis.held, key = "href") { url[key] = "bad"; },
  hrefReflect() { Reflect.set(new URL("http://a/"), "href", "bad"); },
  hrefAssign() { Object.assign(new URL("http://a/"), { href: "bad" }); },
  hrefConverted() { const url = new URL("http://a/"); url.href = { toString() { throw new Error("converted"); } }; },
  hrefSymbol() { const url = new URL("http://a/"); url.href = Symbol("s"); },
  arrayLength() { const list = []; list.length = -1; },
  anyLength(list = globalThis.list) { list.length = -1; },
  getterThis() { URL.prototype.href; },
  getterCall() { Object.getOwnPropertyDescriptor(URL.prototype, "href").get.call(1); },
  setterCall() { Object.getOwnPropertyDescriptor(URL.prototype, "href").set.call(new URL("http://a/"), "bad"); },
  sizeThis() { Map.prototype.size; },
  viewLength() { Object.getPrototypeOf(Uint8Array.prototype).byteLength; },
  headers() { Headers.prototype.get("x"); },
  aborted() { AbortSignal.prototype.aborted; },
};
globalThis.held = new URL("http://b/");
globalThis.list = [1];
for (const [name, way] of Object.entries(ways)) {
  try { way(); console.log(name, "none"); } catch (error) { console.log(name, error.constructor.name, error.message, names(error).join(" < ")); }
}
const url = new URL("http://a/x");
let total = 0;
for (let i = 0; i < 6; i++) { url.href = i & 1 ? "http://c.example/" + i : "http://d/"; total += url.href.length + url.host.length; url.hash = "h" + i; total += url.hash.length; }
console.log(total, url.href, globalThis.held.href, globalThis.list.length);
class Below extends URL { set href(value) { super.href = value + "/below"; } get href() { return super.href; } }
const below = new Below("http://e/");
for (let i = 0; i < 3; i++) below.href = "http://f" + i;
console.log(below.href);
