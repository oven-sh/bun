const log = [];

function show(value) {
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "function") return "function " + value.name;
  if (Array.isArray(value)) return "[" + value.map(show).join(", ") + "]";
  if (typeof value === "object" && value !== null) return "{" + Object.keys(value).map(key => key + ": " + show(value[key])).join(", ") + "}";
  return String(value);
}

console.log("strict code:", (function () { return this === undefined; })());

function Panel(width, height) {
  this.width = width;
  this.height = height;
}
Panel.prototype.area = function () {
  return this.width * this.height;
};

function readInside(scope) {
  var width = "the function's width";
  with (scope) {
    return width;
  }
}

function storeInside(scope) {
  var width = "the function's width";
  with (scope) {
    width = "stored";
  }
  return width;
}

function callInside(scope) {
  function area() {
    return "the function's area, this is " + (this === undefined ? "undefined" : this === globalThis ? "the global object" : "something else");
  }
  with (scope) {
    return area();
  }
}

function declareInside(scope) {
  with (scope) {
    var height = "declared with var";
  }
  return height;
}

function typeofInside(scope) {
  with (scope) {
    return typeof depth;
  }
}

function closureInside(scope) {
  var width = "the function's width";
  with (scope) {
    var reader = function () {
      return width;
    };
  }
  delete scope.width;
  return reader();
}

function addInside(scope) {
  var width = 100;
  with (scope) {
    width += 1;
    return width;
  }
}

const uses = [
  ["read width", readInside],
  ["store to width", storeInside],
  ["call area()", callInside],
  ["var height = ..", declareInside],
  ["typeof depth", typeofInside],
  ["a closure reads width after it was deleted", closureInside],
  ["width += 1", addInside],
];

const scopes = [
  ["an honest panel", () => new Panel(3, 4)],
  ["an empty literal", () => ({})],
  ["a literal with width", () => ({ width: "literal width" })],
  ["width on the prototype", () => Object.create({ width: "inherited width" })],
  ["a getter and a setter", () => ({ get width() { log.push("get"); return "got"; }, set width(value) { log.push("set " + value); } })],
  ["a getter that deletes itself", () => ({ get width() { delete this.width; return "once"; } })],
  ["a frozen panel", () => Object.freeze(new Panel(3, 4))],
  ["width is unscopable", () => ({ width: "hidden width", [Symbol.unscopables]: { width: true } })],
  ["unscopables is a getter", () => ({ width: "seen width", get [Symbol.unscopables]() { log.push("get unscopables"); return undefined; } })],
  ["a proxy that logs", () => new Proxy({ width: "proxied width" }, { has(target, key) { log.push("has " + String(key)); return Reflect.has(target, key); }, get(target, key, receiver) { log.push("get " + String(key)); return Reflect.get(target, key, receiver); }, set(target, key, value, receiver) { log.push("set " + String(key)); return Reflect.set(target, key, value, receiver); } })],
  ["a proxy that has every name", () => new Proxy({}, { has: () => true, get: (target, key) => (key === Symbol.unscopables ? undefined : "answer for " + String(key)) })],
  ["an array", () => [1, 2]],
  ["a function", () => function width() {}],
  ["a string", () => "text"],
  ["a number", () => 5],
  ["null", () => null],
  ["undefined", () => undefined],
  ["an object without a prototype", () => Object.assign(Object.create(null), { width: "bare width" })],
];

for (let i = 0; i < 2000; i++) for (const [, use] of uses) use(new Panel(3, 4));

for (const [label, make] of scopes) {
  for (const [name, use] of uses) {
    const scope = make();
    let line = label + " | " + name + " -> ";
    try {
      line += show(use(scope));
    } catch (error) {
      line += "threw " + error.constructor.name;
    }
    line += " | log " + log.splice(0).join(", ");
    console.log(line + " | now " + (typeof scope === "object" && scope !== null ? show(Object.keys(scope)) : show(scope)));
    log.length = 0;
  }
}
