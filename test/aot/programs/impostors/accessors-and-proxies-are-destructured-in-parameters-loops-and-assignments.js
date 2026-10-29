const log = [];

class Box {
  constructor(width, height) {
    this.width = width;
    this.height = height;
  }
  area() {
    return this.width * this.height;
  }
}

function make() {
  return new Box(3, 4);
}

function takeInParameters({ width, height }) {
  return [width, height];
}

function takeInAForOfHead(boxes) {
  const results = [];
  for (const { width, height = "default height" } of boxes) results.push(width, height);
  return results;
}

function takeIntoTargets(box) {
  let width;
  const target = {};
  ({ width, height: target.height } = box);
  return [width, target.height];
}

function takeNested(parcel) {
  const {
    size: { width, height },
  } = parcel;
  return [width, height];
}

const uses = [
  ["function ({ width, height })", box => takeInParameters(box)],
  ["for (const { width, height = .. } of [honest, this one, honest])", box => takeInAForOfHead([make(), box, make()])],
  ["({ width, height: target.height } = box)", box => takeIntoTargets(box)],
  ["{ size: { width, height } }", box => takeNested({ label: "parcel", size: box })],
];

const impostors = [
  ["a getter without a setter", `({ get width() { log.push("get width"); return 3; }, height: 4 })`],
  ["a getter that counts up", `(count => ({ get width() { return ++count; }, height: 4 }))(0)`],
  ["a getter that throws", `({ get width() { log.push("get width"); throw new RangeError("no width"); }, height: 4 })`],
  ["a getter that deletes itself", `({ get width() { log.push("get width"); delete this.width; return 3; }, height: 4 })`],
  ["a getter that changes height", `({ get width() { log.push("get width"); this.height = "changed"; return 3; }, height: 4 })`],
  ["a setter without a getter", `({ set width(value) { log.push("set width " + String(value)); }, height: 4 })`],
  ["a pair that stores elsewhere", `({ get width() { log.push("get width"); return this.kept; }, set width(value) { log.push("set width " + String(value)); this.kept = value; }, kept: 3, height: 4 })`],
  ["a pair on its prototype", `Object.assign(Object.create({ get width() { log.push("get width, height is " + this.height); return 3; }, set width(value) { log.push("set width " + String(value)); } }), { height: 4 })`],
  ["a getter on its prototype without a setter", `Object.assign(Object.create({ get width() { log.push("get width"); return 3; } }), { height: 4 })`],
  ["a width on its prototype that cannot be written", `Object.assign(Object.create(Object.freeze({ width: 30 })), { height: 4 })`],
  ["a subclass whose width is an accessor", `new (class extends make().constructor { get width() { log.push("get width"); return 99; } set width(value) { log.push("set width " + String(value)); } })(3, 4)`],
  ["an area that is a getter", `({ width: 3, height: 4, get area() { log.push("get area"); return () => "area from a getter"; } })`],
  ["a structured clone of a getter", `structuredClone({ get width() { log.push("get width"); return 3; }, height: 4 })`],
  ["a proxy that logs its traps", `new Proxy({ width: 3, height: 4 }, new Proxy({}, { get(handler, trap) { return function (...inputs) { log.push(typeof inputs[1] === "object" || inputs[1] === undefined ? trap : trap + " " + String(inputs[1])); return Reflect[trap](...inputs); }; } }))`],
  ["a logging proxy around an honest one", `new Proxy(make(), new Proxy({}, { get(handler, trap) { return function (...inputs) { log.push(typeof inputs[1] === "object" || inputs[1] === undefined ? trap : trap + " " + String(inputs[1])); return Reflect[trap](...inputs); }; } }))`],
  ["a logging proxy as its prototype", `Object.create(new Proxy({ width: 30, height: 40 }, new Proxy({}, { get(handler, trap) { return function (...inputs) { log.push(typeof inputs[1] === "object" || inputs[1] === undefined ? trap : trap + " " + String(inputs[1])); return Reflect[trap](...inputs); }; } })))`],
  ["a proxy that answers every name", `new Proxy({}, { get(target, key) { return typeof key === "string" ? key.length : undefined; }, has() { return true; } })`],
  ["a proxy that refuses every change", `new Proxy({ width: 3, height: 4 }, { set() { log.push("set"); return false; }, defineProperty() { log.push("defineProperty"); return false; }, deleteProperty() { log.push("deleteProperty"); return false; } })`],
  ["a revoked proxy", `(pair => (pair.revoke(), pair.proxy))(Proxy.revocable({}, {}))`],
];

function conjure(text) {
  return new Function("make", "log", "return " + text + ";")(make, log);
}

function shorten(parts) {
  return parts.length > 12 ? parts.slice(0, 6).join(", ") + ", .. " + parts.length + " in all" : parts.join(", ");
}

function show(value) {
  if (Object.is(value, -0)) return "-0";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "function") return "function " + value.name;
  if (typeof value === "bigint") return value + "n";
  if (Array.isArray(value)) return "[" + shorten(value.map(show)) + "]";
  if (typeof value === "object" && value !== null) return "{" + shorten(Object.keys(value).map(key => key + ": " + show(value[key]))) + "}";
  return String(value);
}

function report(phase, label, text) {
  for (const [name, use] of uses) {
    let line = phase + " | " + label + " | " + name + " -> ";
    let impostor;
    try {
      impostor = conjure(text);
    } catch (error) {
      console.log(line + "could not be made: " + error.constructor.name);
      continue;
    }
    log.length = 0;
    try {
      line += show(use(impostor));
    } catch (error) {
      line += "threw " + error.constructor.name;
    }
    line += " | log " + log.splice(0).join(", ");
    console.log(line);
  }
}

function showHonestResults() {
  return uses.map(([, use]) => show(use(make()))).join(" ; ");
}

console.log("strict code:", (function () { return this === undefined; })());
for (const [label, text] of impostors) report("before any honest call", label, text);
console.log("honest | " + showHonestResults());
for (let i = 0; i < 2000; i++) for (const [, use] of uses) use(make());
for (const [label, text] of impostors) {
  report("after 2000 honest calls", label, text);
  console.log("honest again | " + showHonestResults());
}

export {};
