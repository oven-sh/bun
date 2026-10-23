// An error's stack is made by walking the frames. Error.captureStackTrace defines a property on the object it is handed; Error.prepareStackTrace is handed call sites, which in sloppy code answer the function and the receiver of a frame: a closure that was "only called" and an object that was "only a receiver" can be kept by code that was never passed either.
function churn(depth) {
  const pair = { left: depth, right: -depth };
  const list = [depth, depth + 1, depth + 2];
  const read = () => pair.left + list[1];
  if (depth > 0) return churn(depth - 1) + read();
  Bun.gc(true);
  return read();
}
// captureStackTrace writes into its operand.
function stamp(o) {
  Error.captureStackTrace(o);
  return o;
}
function stampBelow(o, f) {
  Error.captureStackTrace(o, f);
  return typeof o.stack;
}
let line = "";
for (let i = 0; i < 100; i++) {
  const o = stamp({ tag: "stamped " + i });
  line = [typeof o.stack, Object.keys(o).join(), Object.getOwnPropertyNames(o).join(), o.stack.split("\n")[0], stampBelow({ name: "Custom", message: "m" + i }, stampBelow)].join(" | ");
}
console.log(line);

// prepareStackTrace sees the frames.
const keptFunctions = [];
const keptReceivers = [];
function failsInside() {
  return new Error("walked").stack;
}
function callOnly(f) {
  return f();
}
function callOn(receiver) {
  return receiver.method();
}
function withPrepare(body) {
  const old = Error.prepareStackTrace;
  Error.prepareStackTrace = (error, sites) => {
    for (const site of sites) {
      const f = site.getFunction();
      const self = site.getThis();
      if (typeof f === "function" && f.marked) keptFunctions.push(f);
      if (self && self.marked) keptReceivers.push(self);
    }
    return sites.length > 0 ? "prepared" : "no sites";
  };
  try {
    return body();
  } finally {
    Error.prepareStackTrace = old;
  }
}
function round(i) {
  const captured = { tag: "captured " + i };
  const closure = function () {
    failsInside();
    return captured.tag;
  };
  closure.marked = true;
  const receiver = {
    marked: true,
    tag: "receiver " + i,
    method() {
      return failsInside();
    },
  };
  return callOnly(closure) + "/" + callOn(receiver);
}
for (let i = 0; i < 50; i++) line = round(i).split("/")[0];
console.log(line, keptFunctions.length, keptReceivers.length);
console.log(withPrepare(() => round(50)));
churn(60);
// Whether a call site answers the function and the receiver is the engine's choice. What it has handed out must work.
console.log(keptFunctions.every(f => f() === "captured 50"), keptReceivers.every(r => r.tag === "receiver 50"));

// The text of a stack names the functions on it; the error is made deep below frames that hold objects.
function level3(o) {
  return new Error("deep " + o.tag);
}
function level2(o) {
  const mine = { tag: o.tag + "+2" };
  return level3(mine);
}
function level1(i) {
  const mine = { tag: "t" + i };
  return level2(mine);
}
const errors = [];
for (let i = 0; i < 100; i++) {
  const e = level1(i);
  if (i % 40 === 39) errors.push(e);
}
churn(60);
console.log(errors.map(e => e.message + ":" + typeof e.stack + ":" + e.stack.split("\n")[0]).join(" | "));

// An error that holds its maker's objects.
class Detailed extends Error {
  constructor(message, detail) {
    super(message);
    this.detail = detail;
    Error.captureStackTrace(this, Detailed);
  }
}
function fails(i) {
  throw new Detailed("detailed " + i, { tag: "detail " + i, read: () => "closure of " + i });
}
const caught = [];
for (let i = 0; i < 100; i++) {
  try {
    fails(i);
  } catch (e) {
    if (i % 40 === 39) caught.push(e);
  }
}
churn(60);
console.log(caught.map(e => [e.message, e.detail.tag, e.detail.read(), e instanceof Detailed, e.name].join("/")).join(" | "));
