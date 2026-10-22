// The places that read names of objects are handed numbers, strings, booleans, symbols and bigints, and nothing at all, between the objects.
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
const chain = hide(chainOfClasses());
warm(chain.receiver);
const primitives = [["a number", 5], ["a fraction", 0.5], ["NaN", NaN], ["a string", "text"], ["an empty string", ""], ["true", true], ["false", false], ["a symbol", Symbol("s")], ["a bigint", 10n], ["null", null], ["undefined", undefined]];
for (const [word, value] of primitives) {
  const hidden = hide(value);
  out.push(`${word} | ${warm(hidden)} | ${readAll(chain.receiver)}`);
}
function readToString(value) {
  return value.toString;
}
function readConstructor(value) {
  return value.constructor;
}
function callValueOf(value) {
  return value.valueOf();
}
function callToString(value) {
  return value.toString();
}
for (const [word, value] of [...primitives, ["an object", {}], ["an object without a prototype", Object.create(null)], ["an array", [1, 2]], ["a function", function named() {}], ["an instance", chain.receiver]]) {
  const hidden = hide(value);
  let last = "";
  for (let turn = 0; turn < 200; turn++)
    last = [attempt(() => readToString(hidden)), attempt(() => readConstructor(hidden)), attempt(() => typeof callValueOf(hidden)), attempt(() => callToString(hidden))].join(" ");
  out.push(`names of the prototypes of the language | ${word} | ${last}`);
}
const own = hide({ toString() { return "own toString"; }, valueOf: () => 42, constructor: "own constructor" });
out.push(`an object with names of its own | ${attempt(() => readToString(own))} ${attempt(() => readConstructor(own))} ${attempt(() => callValueOf(own))} ${attempt(() => callToString(own))}`);
delete own.toString;
delete own.constructor;
out.push(`which it loses | ${attempt(() => readToString(own))} ${attempt(() => readConstructor(own))} ${attempt(() => callValueOf(own))} ${attempt(() => callToString(own))}`);
console.log(out.join("\n"));
