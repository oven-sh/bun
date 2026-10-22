// One place reads `length` of whatever comes: arrays, strings, typed arrays, functions, arguments, objects that have the name, inherit it or lack it. Then the objects change.
const out = [];
const suffix = process.argv[2] ?? "";
// What the compiler cannot read: it only knows that the objects go there and come back.
const hide = new Function("value", "return value" + suffix);
function describe(value) {
  if (typeof value === "function") return "function " + value.name;
  if (typeof value === "symbol") return String(value);
  if (typeof value === "object" && value !== null) return JSON.stringify(value);
  return String(value);
}
function attempt(action) {
  try {
    return describe(action());
  } catch (error) {
    return "threw " + error.constructor.name;
  }
}
// One place in the program reads each name, whatever object comes.
function readValue(object) {
  return object.value;
}
function readOther(object) {
  return object.other;
}
function readMissing(object) {
  return object.missing;
}
function callMethod(object) {
  return object.method();
}
function readAll(object) {
  return [attempt(() => readValue(object)), attempt(() => readOther(object)), attempt(() => readMissing(object)), attempt(() => callMethod(object))].join(" ");
}
function warm(object) {
  let last = "";
  for (let turn = 0; turn < 200; turn++) last = readAll(object);
  return last;
}
// Three objects in a row, made in four ways. `value` lies on the receiver, `other` in the middle, `method` at the top, `missing` nowhere.
function chainOfLiterals() {
  const top = { method() { return "method of the top"; } };
  const middle = Object.setPrototypeOf({ other: "other of the middle" }, top);
  const receiver = Object.setPrototypeOf({ value: "value of the receiver" }, middle);
  return { receiver, middle, top };
}
function chainOfCreatedObjects() {
  const top = Object.create(null);
  top.method = function method() { return "method of the top"; };
  const middle = Object.create(top);
  middle.other = "other of the middle";
  const receiver = Object.create(middle);
  receiver.value = "value of the receiver";
  return { receiver, middle, top };
}
function chainOfClasses() {
  class Top {
    method() { return "method of the top"; }
  }
  class Middle extends Top {}
  Middle.prototype.other = "other of the middle";
  class Receiver extends Middle {
    constructor() {
      super();
      this.value = "value of the receiver";
    }
  }
  return { receiver: new Receiver(), middle: Middle.prototype, top: Top.prototype };
}
function chainOfConstructorFunctions() {
  function Top() {}
  Top.prototype.method = function method() { return "method of the top"; };
  function Middle() {}
  Middle.prototype = Object.create(Top.prototype);
  Middle.prototype.other = "other of the middle";
  function Receiver() {
    this.value = "value of the receiver";
  }
  Receiver.prototype = Object.create(Middle.prototype);
  return { receiver: new Receiver(), middle: Middle.prototype, top: Top.prototype };
}
const makers = { literals: chainOfLiterals, "created objects": chainOfCreatedObjects, classes: chainOfClasses, "constructor functions": chainOfConstructorFunctions };
// Each change meets a chain of its own, warm, and a second receiver of the same making that was warm before the change too.
function tryChange(name, change) {
  for (const [kind, make] of Object.entries(makers)) {
    const chain = hide(make());
    const before = warm(chain.receiver);
    const said = attempt(() => change(chain));
    out.push(`${name} | ${kind} | ${before} | ${said} | ${readAll(chain.receiver)} | ${warm(chain.receiver)}`);
  }
}
function readLength(object) {
  return object.length;
}
function lengthOf(object) {
  let last = "";
  for (let turn = 0; turn < 200; turn++) last = attempt(() => readLength(object));
  return last;
}
function show(name, object, change) {
  const hidden = hide(object);
  const before = lengthOf(hidden);
  const said = change ? attempt(() => change(hidden)) : "";
  out.push(`${name} | ${before} | ${said} | ${attempt(() => readLength(hidden))} | ${lengthOf(hidden)}`);
}
show("an empty array", []);
show("an array that grows", [1, 2, 3], a => a.push(4, 5));
show("an array that shrinks", [1, 2, 3], a => { a.length = 1; });
show("an array with a large length", [], a => { a.length = 4294967295; });
show("an array with holes", [1, , 3], a => { a[100000] = 1; });
show("an array of fractions", [0.5, 1.5], a => a.pop());
show("a frozen array", Object.freeze([1, 2]), a => attempt(() => a.push(3)));
show("an array of another class", new (class List extends Array {})(3), a => a.push(1));
show("an array with another prototype", Object.setPrototypeOf([1, 2], { length: "never read" }));
show("an array without a prototype", Object.setPrototypeOf([1, 2], null));
show("a string", "four");
show("an empty string", "");
show("a string made of two", hide("abc") + hide("defgh"));
show("a string of other characters", "\u{1F600}x");
show("a String object", new String("object"), s => { s.extra = 1; });
show("a typed array", new Uint8Array(6));
show("a typed array whose buffer is handed away", new Uint8Array(6), t => { structuredClone(t.buffer, { transfer: [t.buffer] }); });
show("a function", function (a, b, c) {});
show("a function whose length is redefined", function (a, b) {}, f => { Object.defineProperty(f, "length", { value: 9 }); });
show("a function whose length is deleted", function (a, b) {}, f => delete f.length);
show("a bound function", function (a, b, c) {}.bind(null, 1));
show("arguments", (function () { return arguments; })(1, 2, 3), a => { a.length = 1; });
show("an object with the name", { length: 12 }, o => { o.length = "twelve"; });
show("an object that loses the name", { length: 12 }, o => delete o.length);
show("an object that gets the name", {}, o => { o.length = 3; });
show("an object that inherits the name", Object.create({ length: 5 }), o => { Object.getPrototypeOf(o).length = 6; });
show("an object that shadows the name", Object.create({ length: 5 }), o => { o.length = 7; });
show("an object with a getter", { get length() { return "from a getter"; } }, o => { Object.defineProperty(o, "length", { value: 1 }); });
show("an instance of a class with a field", new (class { length = 2; })(), o => { o.length++; });
show("an instance of a class with a getter", new (class { get length() { return 8; } })());
show("a Map, which has none", new Map([[1, 2]]));
show("a proxy of an array", new Proxy([1, 2, 3], {}));
show("a number", 5);
show("true", true);
show("a symbol", Symbol("s"));
show("a bigint", 5n);
show("null", null);
show("undefined", undefined);
console.log(out.join("\n"));
