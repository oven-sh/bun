// `new F(a, b, c, d, e, ..)` with more arguments than are passed in registers, where F is a function held in a property or a variable: what is made, and that the run time is not asked to make it.
// Only the jsc shell can count. Elsewhere the program checks the answers alone.
const count = typeof aotOperationCount === "function" ? aotOperationCount : () => 0;
const attempt = (f) => { try { return f(); } catch (error) { return error instanceof RangeError ? error.message : error.constructor.name; } };
function Request(id, params, raw, query, log, context) {
  this.id = id;
  this.params = params;
  this.raw = raw;
  this.query = query;
  this.log = log;
  this.context = context;
}
Request.prototype.describe = function () { return [this.id, this.params, this.raw, this.query, this.log, this.context].join(); };
function TakesTwo(first, second) { this.sum = first + second; }
function CountsArguments() { this.count = arguments.length; this.last = arguments[arguments.length - 1]; }
function TakesRest(first, ...rest) { this.first = first; this.rest = rest.join("+"); }
function ReturnsObject(a, b, c, d, e) { this.ignored = a; return { sum: a + b + c + d + e }; }
function ReturnsNumber(a, b, c, d, e) { this.sum = a + b + c + d + e; return 7; }
function AsksNewTarget(a, b, c, d, e) { this.isNew = new.target === AsksNewTarget; this.e = e; }
function TakesSeven(a, b, c, d, e, f, g) { this.text = "" + a + b + c + d + e + f + g; }
class Base { constructor(a, b, c, d, e) { this.sum = a + b + c + d + e; } }
class Derived extends Base { constructor(a, b, c, d, e, f) { super(a, b, c, d, e); this.f = f; } }
function OtherRequest(id, params, raw, query, log, context) {
  this.context = context;
  this.log = log;
  this.query = query;
  this.raw = raw;
  this.params = params;
  this.id = id;
}
OtherRequest.prototype.describe = Request.prototype.describe;
// Which function is constructed is not to be seen in the text: each is looked up under a name that is put together.
const all = { Request, OtherRequest, TakesTwo, CountsArguments, TakesRest, ReturnsObject, ReturnsNumber, AsksNewTarget, TakesSeven, Base, Derived };
const context = {};
for (const name of Object.keys(all))
  context[name] = all[["", name].join("")];
const contexts = [{ Request: context.Request }, { Request: context.OtherRequest }];

const seen = new Set();
let before = count("operationAOTConstruct");
for (let i = 0; i < 2000; i++) {
  const request = new contexts[i & 1].Request(i & 1, "p", "r", "q", "l", "c");
  seen.add(request.describe() + " " + (request instanceof Request) + " " + Object.keys(request).join());
}
let calls = count("operationAOTConstruct") - before;
console.log([...seen].join(" | "), calls <= 8 ? "and the run time was asked at most 8 times" : "and the run time was asked " + calls + " times");

const others = new Set();
before = count("operationAOTConstruct");
for (let i = 0; i < 1000; i++) {
  others.add([
    new context.TakesTwo(1, 2, 3, 4, 5, 6).sum,
    new context.CountsArguments(1, 2, 3, 4, 5, 6).count,
    new context.CountsArguments(1, 2, 3, 4, "five").last,
    new context.TakesRest(1, 2, 3, 4, 5, 6).rest,
    new context.ReturnsObject(1, 2, 3, 4, 5).sum,
    new context.ReturnsObject(1, 2, 3, 4, 5).ignored,
    new context.ReturnsNumber(1, 2, 3, 4, 5).sum,
    new context.TakesSeven(1, 2, 3, 4, 5).text,
    new context.TakesSeven(1, 2, 3, 4, 5, 6, 7, 8).text,
  ].join());
}
calls = count("operationAOTConstruct") - before;
console.log([...others].join(" | "), calls <= 8 ? "and the run time was asked at most 8 times" : "and the run time was asked " + calls + " times");

for (let i = 0; i < 3; i++) {
  const asked = new context.AsksNewTarget(1, 2, 3, 4, 5);
  console.log(asked.isNew, asked.e, new context.Base(1, 2, 3, 4, 5).sum, new context.Derived(1, 2, 3, 4, 5, 6).sum, new context.Derived(1, 2, 3, 4, 5, 6).f);
}

// What cannot be constructed, and what is no function of the program.
const arrow = (a, b, c, d, e) => a;
const table = [arrow, undefined, 5, {}, Request.prototype.describe.bind(null), async function (a, b, c, d, e) {}, function* (a, b, c, d, e) {}, Date, Array, Proxy, Request.bind(null, "bound")];
for (const constructor of table)
  console.log(attempt(() => { const made = new constructor(2020, 1, 2, 3, 4, 5); return typeof made + " " + (Array.isArray(made) ? made.join() : made instanceof Date ? made.getFullYear() : made instanceof Request ? made.describe() : "?"); }));

// The prototype is read anew when it is replaced, and an exception leaves through the call.
function Changes(a, b, c, d, e) { this.e = e; }
for (let i = 0; i < 6; i++) {
  if (i === 3)
    Changes.prototype = { kind: "replaced" };
  const holder = { Changes };
  console.log(new holder.Changes(1, 2, 3, 4, i).e, new holder.Changes(1, 2, 3, 4, i).kind);
}
function Throws(a, b, c, d, e) { if (e) throw new RangeError("thrown with " + e); this.fine = true; }
const throwing = { Throws };
for (let i = 0; i < 4; i++)
  console.log(attempt(() => new throwing.Throws(1, 2, 3, 4, i & 1).fine));

// Arguments are evaluated in order, before the callee is asked whether it constructs.
const order = [];
const note = (value) => { order.push(value); return value; };
console.log(attempt(() => new (note(arrow))(note(1), note(2), note(3), note(4), note(5))), order.map((value) => typeof value === "function" ? "callee" : value).join());
