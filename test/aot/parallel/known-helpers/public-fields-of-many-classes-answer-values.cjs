// Classes whose fields the bundler's helper defines, with and without values: parents with the same names, accessors, frozen and other objects, errors; changes behind.
var log = [];
var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => {
  __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
  return value;
};
var classes = [];
{ class C { constructor(a) { __publicField(this, "w", a); __publicField(this, "l", 4); __publicField(this, "k"); } get both() { return String(this.w) + String(this.l); } } classes.push(C); }
{ class C { constructor(a) { __publicField(this, "l", 4); if (a === 3) return; __publicField(this, "w", a); } get both() { return String(this.w) + String(this.l); } } classes.push(C); }
{ class C { constructor(a) { if (a > 1) __publicField(this, "c", a); __publicField(this, "0", a); __publicField(this, "toString", () => "t" + a); __publicField(this, "n", a / 2); } get both() { return String(this.w) + String(this.l); } } classes.push(C); }
{ const Base = class { constructor(a) { this.a = a; } sum() { return this.a; } }; class C extends Base { constructor(a) { super(a); __publicField(this, "w", a); __publicField(this, "l", 4); __publicField(this, "k"); } get both() { return String(this.w) + String(this.l); } } classes.push(C); }
{ const Base = class { constructor(a) { this.a = a; } sum() { return this.a; } }; class C extends Base { constructor(a) { super(a); __publicField(this, "l", 4); if (a === 3) return; __publicField(this, "w", a); } get both() { return String(this.w) + String(this.l); } } classes.push(C); }
{ const Base = class { constructor(a) { this.a = a; } sum() { return this.a; } }; class C extends Base { constructor(a) { super(a); if (a > 1) __publicField(this, "c", a); __publicField(this, "0", a); __publicField(this, "toString", () => "t" + a); __publicField(this, "n", a / 2); } get both() { return String(this.w) + String(this.l); } } classes.push(C); }
{ const Base = class { constructor(a) { this.w = a; this.l = 1; } }; class C extends Base { constructor(a) { super(a); __publicField(this, "w", a); __publicField(this, "l", 4); __publicField(this, "k"); } get both() { return String(this.w) + String(this.l); } } classes.push(C); }
{ const Base = class { constructor(a) { this.w = a; this.l = 1; } }; class C extends Base { constructor(a) { super(a); __publicField(this, "l", 4); if (a === 3) return; __publicField(this, "w", a); } get both() { return String(this.w) + String(this.l); } } classes.push(C); }
{ const Base = class { constructor(a) { this.w = a; this.l = 1; } }; class C extends Base { constructor(a) { super(a); if (a > 1) __publicField(this, "c", a); __publicField(this, "0", a); __publicField(this, "toString", () => "t" + a); __publicField(this, "n", a / 2); } get both() { return String(this.w) + String(this.l); } } classes.push(C); }
{ const Base = class { constructor(a) { __publicField(this, "w", "parent"); __publicField(this, "a"); this.a = a; } }; class C extends Base { constructor(a) { super(a); __publicField(this, "w", a); __publicField(this, "l", 4); __publicField(this, "k"); } get both() { return String(this.w) + String(this.l); } } classes.push(C); }
{ const Base = class { constructor(a) { __publicField(this, "w", "parent"); __publicField(this, "a"); this.a = a; } }; class C extends Base { constructor(a) { super(a); __publicField(this, "l", 4); if (a === 3) return; __publicField(this, "w", a); } get both() { return String(this.w) + String(this.l); } } classes.push(C); }
{ const Base = class { constructor(a) { __publicField(this, "w", "parent"); __publicField(this, "a"); this.a = a; } }; class C extends Base { constructor(a) { super(a); if (a > 1) __publicField(this, "c", a); __publicField(this, "0", a); __publicField(this, "toString", () => "t" + a); __publicField(this, "n", a / 2); } get both() { return String(this.w) + String(this.l); } } classes.push(C); }
{ const Base = class { constructor(a) { this.a = a; } get w() { return "got"; } set w(v) { log.push("set " + v); } }; class C extends Base { constructor(a) { super(a); __publicField(this, "w", a); __publicField(this, "l", 4); __publicField(this, "k"); } get both() { return String(this.w) + String(this.l); } } classes.push(C); }
{ const Base = class { constructor(a) { this.a = a; } get w() { return "got"; } set w(v) { log.push("set " + v); } }; class C extends Base { constructor(a) { super(a); __publicField(this, "l", 4); if (a === 3) return; __publicField(this, "w", a); } get both() { return String(this.w) + String(this.l); } } classes.push(C); }
{ const Base = class { constructor(a) { this.a = a; } get w() { return "got"; } set w(v) { log.push("set " + v); } }; class C extends Base { constructor(a) { super(a); if (a > 1) __publicField(this, "c", a); __publicField(this, "0", a); __publicField(this, "toString", () => "t" + a); __publicField(this, "n", a / 2); } get both() { return String(this.w) + String(this.l); } } classes.push(C); }
{ const Base = class { constructor(a) { this.a = a; } get l() { return "only"; } }; class C extends Base { constructor(a) { super(a); __publicField(this, "w", a); __publicField(this, "l", 4); __publicField(this, "k"); } get both() { return String(this.w) + String(this.l); } } classes.push(C); }
{ const Base = class { constructor(a) { this.a = a; } get l() { return "only"; } }; class C extends Base { constructor(a) { super(a); __publicField(this, "l", 4); if (a === 3) return; __publicField(this, "w", a); } get both() { return String(this.w) + String(this.l); } } classes.push(C); }
{ const Base = class { constructor(a) { this.a = a; } get l() { return "only"; } }; class C extends Base { constructor(a) { super(a); if (a > 1) __publicField(this, "c", a); __publicField(this, "0", a); __publicField(this, "toString", () => "t" + a); __publicField(this, "n", a / 2); } get both() { return String(this.w) + String(this.l); } } classes.push(C); }
{ const Base = class { constructor(a) { this.a = a; if (a === 2) Object.freeze(this); } }; class C extends Base { constructor(a) { super(a); __publicField(this, "w", a); __publicField(this, "l", 4); __publicField(this, "k"); } get both() { return String(this.w) + String(this.l); } } classes.push(C); }
{ const Base = class { constructor(a) { this.a = a; if (a === 2) Object.freeze(this); } }; class C extends Base { constructor(a) { super(a); __publicField(this, "l", 4); if (a === 3) return; __publicField(this, "w", a); } get both() { return String(this.w) + String(this.l); } } classes.push(C); }
{ const Base = class { constructor(a) { this.a = a; if (a === 2) Object.freeze(this); } }; class C extends Base { constructor(a) { super(a); if (a > 1) __publicField(this, "c", a); __publicField(this, "0", a); __publicField(this, "toString", () => "t" + a); __publicField(this, "n", a / 2); } get both() { return String(this.w) + String(this.l); } } classes.push(C); }
{ const Base = class { constructor(a) { this.a = a; if (a % 3 === 1) return { w: "other", odd: a }; } }; class C extends Base { constructor(a) { super(a); __publicField(this, "w", a); __publicField(this, "l", 4); __publicField(this, "k"); } get both() { return String(this.w) + String(this.l); } } classes.push(C); }
{ const Base = class { constructor(a) { this.a = a; if (a % 3 === 1) return { w: "other", odd: a }; } }; class C extends Base { constructor(a) { super(a); __publicField(this, "l", 4); if (a === 3) return; __publicField(this, "w", a); } get both() { return String(this.w) + String(this.l); } } classes.push(C); }
{ const Base = class { constructor(a) { this.a = a; if (a % 3 === 1) return { w: "other", odd: a }; } }; class C extends Base { constructor(a) { super(a); if (a > 1) __publicField(this, "c", a); __publicField(this, "0", a); __publicField(this, "toString", () => "t" + a); __publicField(this, "n", a / 2); } get both() { return String(this.w) + String(this.l); } } classes.push(C); }
{ const Base = class { constructor(a) { this.a = a; if (a === 2) throw new Error("no " + a); } }; class C extends Base { constructor(a) { super(a); __publicField(this, "w", a); __publicField(this, "l", 4); __publicField(this, "k"); } get both() { return String(this.w) + String(this.l); } } classes.push(C); }
{ const Base = class { constructor(a) { this.a = a; if (a === 2) throw new Error("no " + a); } }; class C extends Base { constructor(a) { super(a); __publicField(this, "l", 4); if (a === 3) return; __publicField(this, "w", a); } get both() { return String(this.w) + String(this.l); } } classes.push(C); }
{ const Base = class { constructor(a) { this.a = a; if (a === 2) throw new Error("no " + a); } }; class C extends Base { constructor(a) { super(a); if (a > 1) __publicField(this, "c", a); __publicField(this, "0", a); __publicField(this, "toString", () => "t" + a); __publicField(this, "n", a / 2); } get both() { return String(this.w) + String(this.l); } } classes.push(C); }
{ const Base = class extends Map { constructor(a) { super(); this.a = a; } }; class C extends Base { constructor(a) { super(a); __publicField(this, "w", a); __publicField(this, "l", 4); __publicField(this, "k"); } get both() { return String(this.w) + String(this.l); } } classes.push(C); }
{ const Base = class extends Map { constructor(a) { super(); this.a = a; } }; class C extends Base { constructor(a) { super(a); __publicField(this, "l", 4); if (a === 3) return; __publicField(this, "w", a); } get both() { return String(this.w) + String(this.l); } } classes.push(C); }
{ const Base = class extends Map { constructor(a) { super(); this.a = a; } }; class C extends Base { constructor(a) { super(a); if (a > 1) __publicField(this, "c", a); __publicField(this, "0", a); __publicField(this, "toString", () => "t" + a); __publicField(this, "n", a / 2); } get both() { return String(this.w) + String(this.l); } } classes.push(C); }
{ const Base = class extends Error { constructor(a) { super("m" + a); } }; class C extends Base { constructor(a) { super(a); __publicField(this, "w", a); __publicField(this, "l", 4); __publicField(this, "k"); } get both() { return String(this.w) + String(this.l); } } classes.push(C); }
{ const Base = class extends Error { constructor(a) { super("m" + a); } }; class C extends Base { constructor(a) { super(a); __publicField(this, "l", 4); if (a === 3) return; __publicField(this, "w", a); } get both() { return String(this.w) + String(this.l); } } classes.push(C); }
{ const Base = class extends Error { constructor(a) { super("m" + a); } }; class C extends Base { constructor(a) { super(a); if (a > 1) __publicField(this, "c", a); __publicField(this, "0", a); __publicField(this, "toString", () => "t" + a); __publicField(this, "n", a / 2); } get both() { return String(this.w) + String(this.l); } } classes.push(C); }
{ const Base = class { constructor(a) { Object.defineProperty(this, "w", { value: 1, writable: false, configurable: a > 1 }); } }; class C extends Base { constructor(a) { super(a); __publicField(this, "w", a); __publicField(this, "l", 4); __publicField(this, "k"); } get both() { return String(this.w) + String(this.l); } } classes.push(C); }
{ const Base = class { constructor(a) { Object.defineProperty(this, "w", { value: 1, writable: false, configurable: a > 1 }); } }; class C extends Base { constructor(a) { super(a); __publicField(this, "l", 4); if (a === 3) return; __publicField(this, "w", a); } get both() { return String(this.w) + String(this.l); } } classes.push(C); }
{ const Base = class { constructor(a) { Object.defineProperty(this, "w", { value: 1, writable: false, configurable: a > 1 }); } }; class C extends Base { constructor(a) { super(a); if (a > 1) __publicField(this, "c", a); __publicField(this, "0", a); __publicField(this, "toString", () => "t" + a); __publicField(this, "n", a / 2); } get both() { return String(this.w) + String(this.l); } } classes.push(C); }
function total(list) {
  var t = 0, s = "";
  for (var i = 0; i < list.length; i++) {
    var o = list[i];
    t += +o.w || 0; s += typeof o.w + typeof o.l + typeof o.k + (o.both || "");
    if (typeof o.f === "function") s += o.f();
  }
  return t + s;
}
function show(o, C) {
  var d = Object.getOwnPropertyDescriptors(o);
  return Reflect.ownKeys(o).filter(function (k) { return !/^(stack|line|column|sourceURL|originalLine|originalColumn)$/.test(String(k)); }).map(function (k) { var x = d[k]; return String(k) + (x.get || x.set ? "accessor" : typeof x.value + (typeof x.value === "object" || typeof x.value === "function" ? "" : String(x.value)) + +x.writable) + +x.enumerable + +x.configurable; }).join() + (o instanceof C) + ("w" in o) + ("k" in o);
}
classes.forEach(function (C, number) {
  var objects = [];
  for (var i = 0; i < 5; i++) { try { objects.push(new C(i)); } catch (e) { log.push(e.constructor.name + e.message.slice(0, 20)); objects.push({}); } }
  console.log(number, total(objects));
  try { objects[0].w = "text"; objects[1].extra = 1; delete objects[2].w; } catch (e) { log.push(e.constructor.name); }
  objects.push(Reflect.construct(C, [8], Object), new (class extends C { })(7), new C(1.5));
  console.log(total(objects), objects.map(function (o) { return show(o, C); }).join(" "));
  objects.forEach(function (o) { try { o.l = 12; o.w++; } catch (e) { log.push(e.constructor.name); } });
  console.log(total(objects));
});
console.log(log.join(";"));
