// 200 reads by name find their values along a chain of three objects. Then a Proxy is hung into the chain, or stands in place of an object of it.
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
const log = [];
const watching = target => new Proxy(target, {
  get(object, key, receiver) {
    if (log.length < 8) log.push(String(key));
    return Reflect.get(object, key, receiver);
  },
});
for (const where of ["receiver", "middle", "top"]) {
  tryChange(`a proxy that hands everything on hangs above the ${where}`, chain => { Object.setPrototypeOf(chain[where], new Proxy(Object.getPrototypeOf(chain[where]) ?? {}, {})); });
  tryChange(`a proxy that answers every name hangs above the ${where}`, chain => {
    Object.setPrototypeOf(chain[where], new Proxy({}, { get: (object, key) => (key === "method" ? () => "method of the proxy" : `${String(key)} of the proxy`) }));
  });
  tryChange(`a proxy that throws hangs above the ${where}`, chain => { Object.setPrototypeOf(chain[where], new Proxy({}, { get() { throw new EvalError("trap"); } })); });
  tryChange(`a proxy that watches hangs above the ${where}`, chain => {
    log.length = 0;
    Object.setPrototypeOf(chain[where], watching(Object.getPrototypeOf(chain[where]) ?? {}));
    readAll(chain.receiver);
    return log.join(",");
  });
}
tryChange("the proxy is taken out again", chain => {
  const own = Object.getPrototypeOf(chain.middle);
  Object.setPrototypeOf(chain.middle, new Proxy({}, { get: () => () => "proxy" }));
  const between = warm(chain.receiver);
  Object.setPrototypeOf(chain.middle, own);
  return between;
});
tryChange("a revoked proxy hangs above the middle", chain => {
  const { proxy, revoke } = Proxy.revocable({}, {});
  Object.setPrototypeOf(chain.middle, proxy);
  const between = readAll(chain.receiver);
  revoke();
  return between;
});
for (const [kind, make] of Object.entries(makers)) {
  const chain = hide(make());
  warm(chain.receiver);
  out.push(`the same readers read through a proxy of the receiver | ${kind} | ${warm(hide(new Proxy(chain.receiver, {})))} | ${readAll(chain.receiver)}`);
}
console.log(out.join("\n"));
