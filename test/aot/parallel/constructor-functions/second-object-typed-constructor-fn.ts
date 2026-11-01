// The second object of a typed constructor function has the prototype of its moment.
interface Shape { b?: number; describe(): string }
function say(label: string, made: () => string) { console.log(label + ": " + made()); }
function Q(this: Shape) {}
const first: Shape = Q.prototype;
first.describe = function () { return "first"; };
const second: Shape = { describe() { return "second"; } };
function run() {
  const q = new (Q as unknown as new () => Shape)();
  Q.prototype = second;
  q.b = 1; const r = new (Q as unknown as new () => Shape)(); Q.prototype = first; r.b = 1;
  return String(Object.getPrototypeOf(q) === first) + " " + String(Object.getPrototypeOf(r) === first);
}
say("one", () => run());
say("other", () => "x");
export {};
