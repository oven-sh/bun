// Methods laid on prototypes and records by loops over written names, keys and entries, while somebody changes the list, the record, the prototype or a method.
function attempt(f) {
  try {
    return f();
  } catch (error) {
    return error.constructor.name;
  }
}
function drive(name, object, change, at) {
  let text = "";
  for (let i = 0; i < 24; i++) {
    if (i === at) attempt(change);
    text += attempt(() => object.get(i)) + "," + attempt(() => object.put(2)) + "," + attempt(() => object.late) + (i % 6 ? " " : "|" + attempt(() => Object.keys(Object.getPrototypeOf(object) ?? {}).join("")) + " ");
  }
  console.log(name, at, text);
}
function makeByCallback() {
  class Client {
    constructor(v) { this.v = v; }
    request(method, x) { return method + this.v + x; }
  }
  ["get", "put", "delete"].forEach(function (method) {
    Client.prototype[method] = function (x) { return this.request(method, x); };
  });
  return Client;
}
class Direct {
  constructor(v) { this.v = v; }
  request(method, x) { return method + this.v + x; }
}
for (const method of ["get", "put", "options"]) Direct.prototype[method] = function (x) { return this.request(method, x); };
class Called {
  constructor(v) { this.v = v; }
}
const methods = { get(x) { return this.v + x; }, put(x) { this.v = x; return "put" + x; }, late: 5 };
Object.keys(methods).forEach(name => { Called.prototype[name] = methods[name]; });
class Entered {
  constructor(v) { this.v = v; }
}
for (const [name, method] of Object.entries(methods)) Entered.prototype[name] = method;
function Wrapped(v) { this.v = v; }
Object.keys(methods).forEach(function (name) {
  const method = methods[name];
  Wrapped.prototype[name] = typeof method === "function" ? function (x) { return "w" + method.call(this, x); } : method;
});
class Emptied {
  constructor(v) { this.v = v; }
}
const gone = { get(x) { return x; }, put(x) { return -x; }, late: 1 };
for (const name of Object.keys(gone)) {
  delete gone.put;
  Emptied.prototype[name] = gone[name];
}
class Accessed {
  constructor(v) { this.v = v; }
}
const accessors = { get get() { return x => "read" + x; }, put(x) { return x; }, late: 2 };
for (const name of Object.keys(accessors)) Accessed.prototype[name] = accessors[name];
const record = { v: 1 };
["get", "put"].forEach(name => { record[name] = function (x) { return name + this.v + x; }; });
const names = ["get", "put"];
class Grown {
  constructor(v) { this.v = v; }
}
names.forEach(function (name, at, list) {
  if (list.length < 3) list.push("late");
  Grown.prototype[name] = function (x) { return name + at + x; };
});
let callback;
class Shared {
  constructor(v) { this.v = v; }
}
["get"].forEach(callback = name => { Shared.prototype[name] = x => name + x; });
callback("put");
const classes = { callback: makeByCallback(), direct: Direct, called: Called, entered: Entered, wrapped: Wrapped, emptied: Emptied, accessed: Accessed, grown: Grown, shared: Shared };
for (const [name, Class] of Object.entries(classes)) {
  drive(name, new Class(3), () => {}, 0);
  drive(name, new Class(4), () => { Class.prototype.get = x => "replaced" + x; }, 7);
  drive(name, new Class(5), () => { delete Class.prototype.put; }, 9);
  drive(name, new Class(6), () => { Object.defineProperty(Class.prototype, "late", { get() { return this.v + 100; }, configurable: true }); }, 11);
}
drive("record", record, () => { record.get = 3; }, 10);
methods.get = x => "changed" + x;
drive("called", new Called(1), () => {}, 0);
const other = new (makeByCallback())(9);
console.log(attempt(() => other.delete(1)), attempt(() => new (makeByCallback())(8).get(2)), Object.getOwnPropertyNames(Direct.prototype).join());
