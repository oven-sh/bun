// Object.assign({}, source) under the names of an alias and of compilers' helpers: what it copies, what it runs and what it throws.
const print = (...values) => console.log(values.map(value => value && typeof value === "object" ? Reflect.ownKeys(value).map(key => String(key) + ":" + String(value[key])).join(",") + (Object.getPrototypeOf(value) === Object.prototype) : String(value)).join(" "));
var __assign = (this && this.__assign) || function () {
  __assign = Object.assign || function (t) { for (var s, i = 1, n = arguments.length; i < n; i++) { s = arguments[i]; for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p)) t[p] = s[p]; } return t; };
  return __assign.apply(this, arguments);
};
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
const assign = Object.assign;
let objectAssign = Object.assign;
class Item { constructor(n) { this.n = n; this.text = "i" + n; } get twice() { return this.n * 2; } }
let ran = 0;
const sources = n => [
  null, undefined, 5, "ab", true, [1, , 3], { a: n, b: "b" }, { a: 1, get b() { ran++; return ran; }, c: 3 }, { a: 1, get b() { throw new Error("thrown"); }, c: 3 }, new Item(n),
  Object.create({ above: 1 }, { own: { value: 1, enumerable: true }, hidden: { value: 2 } }), { [Symbol.for("s")]: 1, 1: "one", 0: "zero", z: 2 }, JSON.parse('{"__proto__": {"p": 1}, "a": 2}'),
  new Proxy({ a: 1, b: 2 }, { get(target, key) { ran++; return target[key]; } }), Object.freeze({ a: n }), () => 1, new Map([[1, 2]]), new String("xy"),
];
const copies = [
  source => assign({}, source),
  source => __assign({}, source),
  source => _extends({}, source),
  source => objectAssign({}, source),
  source => { const copy = __assign({}, source); copy.a = "changed"; copy.late = 1; return copy; },
  source => __assign(__assign({}, source), { locked: true }),
  source => _extends({}, source, { locked: true }, source),
  source => Object.assign({}, source, { locked: true }, source),
  source => { const copy = {}; try { assign(copy, source); } catch (error) { print(error.message, copy); } return copy; },
  source => { const copy = assign({}, source); delete copy.a; Object.defineProperty(copy, "b", { get: () => 7, enumerable: true, configurable: true }); return copy; },
  source => Object.freeze(assign({}, source)),
];
for (let turn = 0; turn < 3; turn++) {
  for (const copy of copies) for (const source of sources(turn)) { try { print(copy(source)); } catch (error) { print(error.name, error.message); } }
  print(ran);
}
objectAssign = (target, source) => { target.mine = source === null; return target; };
for (const source of sources(1)) print(copies[3](source));
__assign = function (target) { target.replaced = arguments.length; return target; };
for (const source of sources(1)) print(copies[1](source), copies[5](source));
