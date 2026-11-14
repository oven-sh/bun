// Tables filled under a key that is handed over: texts of the program, `__proto__` among them, texts that are put together, numbers, symbols, and objects whose toString runs.
const out = [];
const log = (...values) => out.push(values.join(" "));
const show = run => { try { const v = run(); return typeof v === "function" ? "function " + v.name : typeof v === "symbol" ? String(v) : typeof v === "object" && v ? JSON.stringify(v) : String(v); } catch (error) { return error.constructor.name; } };
class Point {
  constructor(x, y) { this._x = x; this._y = y; }
  get x() { return this._x; }
  add(o) { return new Point(this._x + o._x, this._y + o._y); }
}
const routes = {}, classes = {}, linked = {}, joined = {}, odd = {}, mixed = {};
function on(path, handle) { routes[path] = handle; }
function register(name, type) { classes[name] = type; }
on("/a", p => p.x);
on("constructor", p => p.add(p).x);
on("toString", () => "its own");
register("A.Point", Point);
register("7", class Seven { get x() { return 7; } });
const call = (path, p) => (routes[path] ? routes[path](p) : "none");
let sum = new Point(0, 0);
for (let i = 0; i < 1000; i++) sum = sum.add(new Point(i, 1));
log(sum.x, call("/a", sum), call("constructor", sum), call("toString", sum), call("/b", sum), show(() => call("valueOf", sum)), show(() => routes.__proto__ === Object.prototype));
log(new classes["A.Point"](3, 4).add(sum).x, new classes[7]().x, Object.keys(classes).join());
function link(name, value) { linked[name] = value; return linked; }
link("first", { a: 1 });
log(link("__proto__", new Point(5, 6)).x, linked.first.a, show(() => linked.add(sum).x), Object.keys(linked).join(), linked instanceof Point);
function join(name, value) { joined[name] = value; return joined; }
join("a" + out.length, 1);
join(["__pro", "to__"].join(""), new Point(8, 9));
log(joined.x, show(() => joined.add(sum).x), Object.keys(joined).join());
function put(key, value) { odd[key] = value; return odd; }
put(-0, 1); put(2 ** 32, 2); put(NaN, 3); put(true, 4); put(null, 5); put(undefined, 6); put(Symbol.for("s"), 7); put({ toString: () => "made" }, 8); put(["__proto__"], { above: 9 });
log(Object.keys(odd).join(), odd[0], odd[Symbol.for("s")], odd.made, odd.above, Object.getPrototypeOf(odd) === Object.prototype);
for (const key of ["x", "__proto__", "y"]) mixed[key] = { key };
log(Object.keys(mixed).join(), mixed.key, show(() => mixed.x.key));
const read = (o, key) => o[key];
log(read(sum, "_x"), read(sum, "x"), show(() => read(sum, "add")), show(() => read(sum, "constructor")), read(sum, "__proto__") === Point.prototype, read(sum, "none"));
console.log(out.join("\n"));
