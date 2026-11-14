// Two tests of one value, each in a condition of its own, in both orders: what both leave is an object, and nothing but an object comes there.
const given = [
  null, undefined, 0, 1.5, NaN, "", "text", true, false, 7n, Symbol.for("s"),
  {}, { a: 1 }, [], [1, 2], new Date(0), /x/g, new Map([[1, 2]]), Object.create(null), new Proxy({ a: 2 }, {}), Object(1), Object("box"),
  () => 1, function named() {}, class Made {}, new Uint8Array(2), JSON.parse('{"a":3}'), JSON.parse("null"), JSON.parse("[4]"),
];
const hide = x => [x][JSON.parse("0")];
const nameOf = x => (x === null ? "null" : x === Object.prototype ? "Object.prototype" : x === Array.prototype ? "Array.prototype" : x === Date.prototype ? "Date.prototype" : typeof x);
function objectThenNotNull(x) {
  if (typeof x === "object" && x !== null) return "o" + Object.keys(x).length + nameOf(Object.getPrototypeOf(x));
  return "-";
}
function notNullThenObject(x) {
  if (x !== null && typeof x === "object") return "o" + Object.keys(x).length + nameOf(Object.getPrototypeOf(x));
  return "-";
}
function leaves(x) {
  if (typeof x !== "object" || x === null) return "-";
  const above = Object.getPrototypeOf(x);
  return above === null || above === Object.prototype || Object.getPrototypeOf(above) === null ? "plain" : "other";
}
function loosely(x) {
  if (typeof x === "object" && x != null) return "o" + (x.a ?? "none");
  return "-";
}
function nested(x) {
  if (typeof x === "object") {
    if (x === null) return "null";
    if (x === undefined) return "never";
    return Array.isArray(x) ? "list" + x.length : "object" + String(Object.getOwnPropertyNames(x).length);
  }
  if (x === null) return "never";
  return typeof x;
}
function afterwards(x) {
  if (x === null) return "null";
  if (typeof x === "object") {
    x = x.a;
    if (typeof x === "object" && x !== null) return "deep";
    return "a:" + String(x);
  }
  if (typeof x === "function" && x !== null) return "f" + x.length;
  return typeof x;
}
function inLoop(list) {
  let objects = 0, others = 0, deep = 0;
  for (const x of list) {
    if (typeof x === "object" && x !== null) {
      objects++;
      for (const key in x) if (typeof x[key] === "object" && x[key] !== null) deep++;
    } else others++;
  }
  return [objects, others, deep].join(" ");
}
function isPlainObject(x) {
  if (typeof x !== "object" || x === null) return false;
  let above = x;
  while (Object.getPrototypeOf(above) !== null) above = Object.getPrototypeOf(above);
  return Object.getPrototypeOf(x) === above;
}
for (const f of [objectThenNotNull, notNullThenObject, leaves, loosely, nested, afterwards, isPlainObject]) console.log(f.name, given.map(x => f(hide(x))).join(" "));
console.log(inLoop(given.map(hide)), inLoop([hide({ a: { b: null } }), hide(null), hide(5)]));
let fromOutside = JSON.parse(process.argv[2] ?? "null");
if (typeof fromOutside === "object" && fromOutside !== null) console.log(Object.getPrototypeOf(Object.getPrototypeOf(fromOutside)));
else console.log("nothing", typeof fromOutside);
Object.defineProperty(String.prototype, "later", { configurable: true, value: 1 });
console.log("".later, typeof hide("x") === "object" && hide("x") !== null);
