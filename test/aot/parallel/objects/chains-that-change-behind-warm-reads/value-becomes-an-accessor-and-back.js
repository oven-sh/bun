// 200 reads by name find values along a chain of three objects. Then a value becomes an accessor, an accessor another accessor, an accessor a value again; a method becomes a getter.
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
const places = [["receiver", "value"], ["middle", "other"], ["top", "method"]];
for (const [where, key] of places) {
  const answer = key === "method" ? () => `from the getter of the ${where}` : `from the getter of the ${where}`;
  tryChange(`${key} on the ${where} becomes a getter`, chain => { Object.defineProperty(chain[where], key, { get() { return answer; }, configurable: true }); });
  tryChange(`${key} on the ${where} becomes a getter that reads its receiver`, chain => {
    Object.defineProperty(chain[where], key, { get() { const own = this === chain.receiver; return key === "method" ? () => own : own; }, configurable: true });
  });
  tryChange(`${key} on the ${where} becomes a setter alone`, chain => { Object.defineProperty(chain[where], key, { set(v) {}, configurable: true }); });
  tryChange(`${key} on the ${where} becomes a getter that throws`, chain => { Object.defineProperty(chain[where], key, { get() { throw new RangeError("no"); }, configurable: true }); });
  tryChange(`${key} on the ${where} becomes a getter, another getter, a value`, chain => {
    const seen = [];
    Object.defineProperty(chain[where], key, { get() { return answer; }, configurable: true });
    seen.push(warm(chain.receiver));
    Object.defineProperty(chain[where], key, { get() { return key === "method" ? () => "second getter" : "second getter"; }, configurable: true });
    seen.push(warm(chain.receiver));
    Object.defineProperty(chain[where], key, { value: key === "method" ? () => "a value again" : "a value again", writable: true, configurable: true });
    return seen.join(",");
  });
  tryChange(`${key} on the ${where} becomes read-only and hidden`, chain => { Object.defineProperty(chain[where], key, { writable: false, enumerable: false }); });
}
tryChange("a getter counts its calls", chain => {
  let calls = 0;
  Object.defineProperty(chain.middle, "other", { get() { return ++calls; }, configurable: true });
  warm(chain.receiver);
  return calls;
});
tryChange("a getter is hung in front of a value", chain => { Object.defineProperty(chain.receiver, "other", { get() { return "getter in front"; }, configurable: true }); });
tryChange("a getter appears where nothing was", chain => { Object.defineProperty(chain.top, "missing", { get() { return "no longer missing"; }, configurable: true }); });
console.log(out.join("\n"));
