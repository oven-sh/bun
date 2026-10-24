// One place reads a name of objects of sixty makings in turn. Then what they share changes, and then each of them.
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
const shared = { other: "other of what they share", method() { return "method of what they share"; } };
const objects = [];
for (let i = 0; i < 60; i++) {
  const object = Object.create(shared);
  for (let j = 0; j < i % 12; j++) object["before" + i + "_" + j] = j;
  if (i % 3) object.value = "value " + i;
  for (let j = 0; j < i % 5; j++) object["behind" + i + "_" + j] = j;
  objects.push(hide(object));
}
function sweep() {
  let text = "";
  for (const object of objects) text += readAll(object).length + ",";
  return text;
}
function digest() {
  let sum = 0;
  const seen = new Set();
  for (const object of objects) {
    const all = readAll(object);
    seen.add(all.replace(/value \d+/, "value N"));
    sum += all.length;
  }
  return sum + " " + [...seen].sort().join(" / ");
}
for (let turn = 0; turn < 20; turn++) sweep();
out.push("warm | " + digest());
shared.other = "replaced";
out.push("what they share gets another value | " + digest());
shared.missing = "no longer missing";
out.push("what they share gets a name | " + digest());
delete shared.method;
out.push("what they share loses a name | " + digest());
Object.defineProperty(shared, "value", { get() { return "value from a getter above"; }, configurable: true });
out.push("what they share gets a getter | " + digest());
for (let i = 0; i < objects.length; i += 2) delete objects[i].value;
out.push("every second object loses its own | " + digest());
for (let i = 0; i < objects.length; i += 4) objects[i].method = () => "own method";
out.push("every fourth object gets a method | " + digest());
Object.setPrototypeOf(shared, { method() { return "method from further up"; } });
out.push("what they share gets a prototype | " + digest());
for (let i = 0; i < objects.length; i += 5) Object.setPrototypeOf(objects[i], null);
out.push("every fifth object loses its prototype | " + digest());
for (let turn = 0; turn < 20; turn++) sweep();
out.push("warm again | " + digest());
console.log(out.join("\n"));
