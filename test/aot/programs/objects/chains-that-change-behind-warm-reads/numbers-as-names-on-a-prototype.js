// Reads under numbers and under names that look like numbers, warm, along a chain of three objects. Then a prototype gets such a property.
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
function readZero(object) {
  return object[0];
}
function readText(object) {
  return object["1"];
}
function readAt(object, key) {
  return object[key];
}
function readNumbers(object) {
  return [attempt(() => readZero(object)), attempt(() => readText(object)), attempt(() => readAt(object, 2)), attempt(() => readAt(object, "3")), attempt(() => readAt(object, "value"))].join(" ");
}
function tryNumbers(name, change) {
  for (const [kind, make] of Object.entries(makers)) {
    const chain = hide(make());
    let before = "";
    for (let turn = 0; turn < 200; turn++) before = readNumbers(chain.receiver);
    const said = attempt(() => change(chain));
    out.push(`${name} | ${kind} | ${before} | ${said} | ${readNumbers(chain.receiver)}`);
  }
}
for (const where of ["receiver", "middle", "top"]) {
  tryNumbers(`the ${where} gets four numbers`, chain => { for (let i = 0; i < 4; i++) chain[where][i] = `${i} of the ${where}`; });
  tryNumbers(`the ${where} gets a getter under a number`, chain => { Object.defineProperty(chain[where], 0, { get() { return "getter under 0"; }, configurable: true }); });
  tryNumbers(`the ${where} gets and loses numbers`, chain => {
    for (let i = 0; i < 4; i++) chain[where][i] = i;
    const between = readNumbers(chain.receiver);
    for (let i = 0; i < 4; i++) delete chain[where][i];
    return between;
  });
}
const list = hide([10, , 30]);
let beforeHole = "";
for (let turn = 0; turn < 200; turn++) beforeHole = readNumbers(list);
const above = Object.create(Array.prototype);
above[1] = "from above the array";
Object.setPrototypeOf(list, above);
out.push(`a hole of an array and a prototype with a number | ${beforeHole} | ${readNumbers(list)}`);
console.log(out.join("\n"));
