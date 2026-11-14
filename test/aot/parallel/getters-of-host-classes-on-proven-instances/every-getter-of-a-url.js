// Every getter of URL, URLSearchParams and other host classes on instances whose class is known.
const seen = [];
function partsOf(text) {
  const url = new URL(text);
  return [url.href, url.origin, url.protocol, url.username, url.password, url.host, url.hostname, url.port, url.pathname, url.search, url.hash, url.searchParams.size, url.searchParams === url.searchParams].join(" ");
}
const texts = ["https://user:pass@a.example:8080/b/c?d=e&f=g#h", "http://a.example", "file:///a/b", "data:text/plain,hello", "https://a.example/%E4%BD%A0?x=%20#%23", "https://xn--caf-dma.example/é"];
for (let round = 0; round < 50; round++) { seen.length = 0; for (const text of texts) seen.push(partsOf(text)); }
class Below extends URL { get pathname() { return "below " + super.pathname; } }
const below = new Below("https://a.example/b"), fixed = new URL("https://a.example/c");
function readBoth() { return [below.pathname, below.href, fixed.pathname, fixed.href].join(" "); }
for (let round = 0; round < 50; round++) readBoth();
seen.push(readBoth());
Object.defineProperty(fixed, "pathname", { value: "shadowed", configurable: true });
seen.push(readBoth());
delete fixed.pathname;
seen.push(readBoth());
fixed.pathname = "/written"; fixed.hash = "#new"; fixed.search = "?q=1";
seen.push(fixed.href, fixed.pathname, fixed.hash, fixed.search, String(fixed.searchParams));
function sizes() {
  const params = new URLSearchParams("a=1&b=2&a=3"), map = new Bun.CookieMap("x=1; y=2"), headers = new Headers({ a: "b" });
  return [params.size, map.size, [...headers].length].join(" ");
}
for (let round = 0; round < 50; round++) sizes();
seen.push(sizes());
const getter = Object.getOwnPropertyDescriptor(URL.prototype, "pathname").get;
for (const receiver of [fixed, below, {}, null, "text", URL.prototype, new Headers()]) {
  try { seen.push(String(getter.call(receiver))); } catch (error) { seen.push(error.constructor.name); }
}
for (const receiver of [URL.prototype, Object.create(fixed)]) {
  try { seen.push(String(receiver.pathname)); } catch (error) { seen.push(error.constructor.name); }
}
console.log(seen.join("\n"));
