// `new URLPattern(..)` makes an instance of URLPattern. It is handed on, asked for its members and printed.
const kept: unknown[] = [];
function handOn<T>(value: T): T {
  for (let i = 0; i < 2; i++) kept.length = Math.min(kept.length, 64);
  kept.push(value);
  return value;
}
const patterns = [new URLPattern({ pathname: "/books/:id" }), new URLPattern("/a/*", "https://example.test"), new URLPattern("https://*.example.test/:x(\\d+)", { ignoreCase: true }), new URLPattern()];
for (const pattern of patterns.map(handOn)) {
  console.log(Object.prototype.toString.call(pattern), pattern instanceof URLPattern, Object.getPrototypeOf(pattern) === URLPattern.prototype, pattern.pathname, pattern.hostname, pattern.hasRegExpGroups);
  const found = pattern.exec("https://shop.example.test/books/12");
  console.log(pattern.test("https://shop.example.test/books/12"), found === null ? "null" : `${Object.getPrototypeOf(found) === Object.prototype} ${Array.isArray(found.inputs)} ${JSON.stringify(found.pathname)}`);
}
for (const operands of [[1], [{ pathname: "(" }], ["/a"], [Symbol.iterator], [{ get pathname() { return "/from-a-getter"; } }]] as unknown[][]) {
  try {
    console.log(handOn(new URLPattern(...(operands as [string]))).pathname);
  } catch (error) {
    console.log(Object.getPrototypeOf(error).constructor.name);
  }
}
try {
  (URLPattern as unknown as (input: object) => unknown)({});
} catch (error) {
  console.log(Object.getPrototypeOf(error).constructor.name);
}
class Narrow extends URLPattern {
  label = "made by the program";
}
const narrow = handOn(new Narrow({ pathname: "/n" }));
console.log(narrow.label, narrow instanceof Narrow, narrow.pathname, kept.length);
