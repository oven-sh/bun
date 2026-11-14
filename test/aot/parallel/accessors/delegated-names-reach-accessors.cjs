// koa's delegates: the accessors of a prototype read this[target][name], where the target's name is a field of the delegator and the target has accessors of its own.
// STATISTIC: AccessesDispatchedByKeyString >= 6
// STATISTIC: GettersExpectedInLoops >= 5
const show = (v) => Object.is(v, -0) ? "-0" : typeof v === "object" && v ? JSON.stringify(v) : String(v);
const lines = [];
const attempt = (f) => { try { return show(f()); } catch (e) { return e.constructor.name; } };
const tell = (...fs) => lines.push(fs.map(attempt).join(" "));
function Delegator(proto, target) {
  if (!(this instanceof Delegator)) return new Delegator(proto, target);
  this.proto = proto;
  this.target = target;
  this.getters = [];
}
Delegator.prototype.access = function (name) { return this.getter(name).setter(name); };
Delegator.prototype.getter = function (name) {
  const proto = this.proto, target = this.target;
  this.getters.push(name);
  proto.__defineGetter__(name, function () { return this[target][name]; });
  return this;
};
Delegator.prototype.setter = function (name) {
  const proto = this.proto, target = this.target;
  proto.__defineSetter__(name, function (value) { return this[target][name] = value; });
  return this;
};
const proto = { inspect() { return "context"; } };
const response = {
  get status() { return this.res.statusCode; }, set status(code) { this.res.statusCode = code; },
  get body() { return this._body; }, set body(value) { if (value === "refused") throw new RangeError(value); this._body = value; },
};
Delegator(proto, "response").access("status").access("body");
function createContext() {
  const context = Object.create(proto);
  const made = context.response = Object.create(response);
  made.res = { statusCode: 404 };
  made._body = 0;
  return context;
}
const context = createContext();
function serve(turns) { let n = 0; for (let k = 0; k < turns; k++) { context.status = k & 7; context.body = k; n = (n + context.status + context.body) & 1023; } return n; }
function stores(turns, value) { for (let k = 0; k < turns; k++) context.body = value; return context.body; }
function reads(turns) { let n = 0; for (let k = 0; k < turns; k++) n += context.status; return n; }
// The target's name is an argument, and the field behind the accessor is made beside the object.
function access(target, inner, name) { target.__defineGetter__(name, function () { return this[inner][name]; }); target.__defineSetter__(name, function (value) { this[inner][name] = value; }); }
const above = { kind: "above" };
access(above, "data", "count"); access(above, "data", "total");
function create() { const object = Object.create(above); object.data = { count: 1, total: 2 }; return object; }
const object = create();
function counts(turns) { let n = 0; for (let k = 0; k < turns; k++) { object.count = k & 7; n = (n + object.count + object.total) & 1023; } return n; }
// One field for two names, stored where the object is made and by the setter.
const plain = { kind: "plain" };
for (const name of ["first", "second"]) { plain.__defineGetter__(name, function () { return this.held; }); plain.__defineSetter__(name, function (value) { this.held = value; }); }
function createPlain() { const made = Object.create(plain); made.held = 1; return made; }
let single = createPlain();
function holds(turns) { const held = single; let n = 0; for (let k = 0; k < turns; k++) { held.first = k & 7; n = (n + held.first + held.second) & 1023; } return n; }
const all = () => tell(() => serve(0), () => serve(1), () => serve(60), () => stores(3, "text"), () => reads(20), () => counts(1), () => counts(50), () => holds(1), () => holds(50), () => context.response, () => object.data, () => single);
all(); all();
context.response._body = 0.5; object.data.count = "s"; object.data.total = -0; single.held = "held"; all();
context.response.res = { statusCode: 2 ** 31 }; object.data = { count: 1, total: 2 }; single = createPlain(); all();
context.body = undefined; context.status = "404"; object.total = null; single.second = [1]; all();
const other = createContext(); other.body = "other"; other.status = 7; tell(() => other.body, () => other.status, () => other.response, () => context.response);
tell(() => stores(2, "refused"), () => Object.keys(context), () => Object.keys(object), () => Object.keys(single));
console.log(lines.join("\n"));
