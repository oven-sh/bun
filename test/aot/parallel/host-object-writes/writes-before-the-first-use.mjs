function relies() {
  return [
    Date.now() > 0,
    Math.floor(1.5),
    JSON.stringify(1),
    WebAssembly.validate(new Uint8Array(0)),
    new Intl.NumberFormat("en").format(1),
    performance.now() >= 0,
    new TextEncoder().encode("a").length,
    crypto.randomUUID().length,
    new AbortController().signal.aborted,
    typeof Bun.hash("a"),
    Reflect.ownKeys({}).length,
    Atomics.load(new Int32Array(1), 0),
    new URLSearchParams("a=1").get("a"),
    Buffer.byteLength("a"),
    typeof process.hrtime.bigint(),
    structuredClone(1),
    Number.parseFloat("1.5"),
    Object.keys({ a: 1 }).length,
    Array.isArray([]),
    String.fromCharCode(65),
    Symbol.for("a").description,
    Promise.resolve(1) instanceof Promise,
    new Intl.DateTimeFormat("en").resolvedOptions().locale,
    new Headers({ a: "1" }).get("a"),
    new URL("http://a/b").pathname,
    Bun.inspect(1),
    new TextDecoder().decode(new Uint8Array([65])),
  ].join(" ");
}
const paths = [
  "Intl.NumberFormat.prototype.format",
  "Intl.DateTimeFormat.prototype.resolvedOptions",
  "TextEncoder.prototype.encode",
  "TextDecoder.prototype.decode",
  "Reflect.ownKeys",
  "Atomics.load",
  "WebAssembly.validate",
  "Intl.NumberFormat",
  "performance.now",
  "process.hrtime",
];
if (process.env.ORDER === "use-first") relies();
for (const path of paths) {
  const names = path.split(".");
  const last = names.pop();
  let holder = globalThis;
  for (const name of names) holder = holder[name];
  const before = Object.getOwnPropertyDescriptor(holder, last);
  let outcome = "assigned";
  try {
    holder[last] = 1;
    if (holder[last] !== 1) outcome = "ignored";
  } catch (error) {
    outcome = error.name;
  }
  if (outcome === "assigned") before ? Object.defineProperty(holder, last, before) : delete holder[last];
  let defined = "defined";
  try {
    Object.defineProperty(holder, last, { value: 2, configurable: true, writable: true });
  } catch (error) {
    defined = error.name;
  }
  if (defined === "defined") before ? Object.defineProperty(holder, last, before) : delete holder[last];
  console.log(path, outcome, defined);
}
console.log(relies());

/* Output:
Intl.NumberFormat.prototype.format TypeError TypeError
Intl.DateTimeFormat.prototype.resolvedOptions TypeError TypeError
TextEncoder.prototype.encode TypeError TypeError
TextDecoder.prototype.decode TypeError TypeError
Reflect.ownKeys TypeError TypeError
Atomics.load TypeError TypeError
WebAssembly.validate assigned defined
Intl.NumberFormat assigned defined
performance.now assigned defined
process.hrtime assigned defined
true 1 1 false 1 true 1 36 false bigint 0 0 1 1 bigint 1 1.5 1 true A a true en 1 /b 1 A
*/
