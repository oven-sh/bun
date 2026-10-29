// `super(a, b, c, ..)` and `new Derived(a, b, c, ..)` with more arguments than fit in registers, where nothing is known of the parent or of the callee.
// Only the jsc shell can count. Elsewhere the program checks the answers alone.
// Env: JSC_aotCountsPath=/dev/null
const count = typeof aotOperationCount === "function" ? aotOperationCount : () => 0;
// What the shell has counted so far: a line "<calls>\toperation:<name>" for each operation of the run time that compiled code has called.
const countsSoFar = () => (typeof aotRuntimeCounters === "function" ? aotRuntimeCounters() : "");
// The calls in such a text, whatever they were for, but for the operations named.
function callsIn(counts, ...besides) {
  let sum = 0;
  for (const line of counts.split("\n")) {
    const [calls, name] = line.split("\toperation:");
    if (name !== undefined && !besides.includes(name)) sum += Number(calls);
  }
  return sum;
}
// These make the text that is printed, list the names for it and keep it in a set; a cell or an array where the allocator has none at hand is the work of the run time; a place that several kinds of objects pass tries now and then to remember the one that it sees.
const owed = ["operationAOTConcat", "operationAOTConcatenate", "operationAOTSetAdd", "operationAOTStackStringBuilderAppend", "operationAOTStackStringBuilderFinish", "operationAOTValueAdd", "operationAOTOwnPropertyKeys", "operationAOTAllocateSlow", "operationAOTArraySlice", "operationAOTFillSiteCache"];
function Request(id, params, raw, query, log, context) {
  this.id = id;
  this.params = params;
  this.raw = raw;
  this.query = query;
  this.log = log;
  this.context = context;
  this.given = arguments.length;
}
Request.prototype.show = function () { return this.constructor.name + " " + Object.keys(this).map(key => key + "=" + this[key]).join(); };
class Base {
  constructor(a, b, c, d, e, f, g, h, i, j) {
    this.all = [a, b, c, d, e, f, g, h, i, j].join("");
  }
  show() { return this.constructor.name + " " + this.all; }
}
class AsksTarget {
  constructor(a, b, c, d, e, f, g, h, i, j) {
    this.all = [a, b, c, d, e, f, g, h, i, j].join("");
    this.target = new.target.name;
  }
  show() { return this.constructor.name + " " + this.all + " " + this.target; }
}
const parents = { Request, Base, AsksTarget };
class OverFunction extends parents.Request {
  constructor(a, b, c, d, e, f, g, h, i, j) {
    super(a, b, c, d, e, f, g, h, i, j);
    this.last = j;
  }
}
class OverClass extends parents.Base {
  constructor(a, b, c, d, e, f, g, h, i, j) {
    super(j, i, h, g, f, e, d, c, b, a);
    this.more = a + j;
  }
  show() { return super.show() + " " + this.more; }
}
parents.OverClass = OverClass;
class OverDerived extends parents.OverClass {
  constructor(a, b, c, d, e, f, g, h, i, j, k) {
    super(a, b, c, d, e, f, g, h, i, k);
    this.skipped = j;
  }
  show() { return super.show() + " " + this.skipped; }
}
class OverAsksTarget extends parents.AsksTarget {
  constructor(a, b, c, d, e, f, g, h, i, j) {
    super(a, b, c, d, e, f, g, h, i, j);
  }
}
class OverArray extends Array {
  constructor(a, b, c, d, e, f, g, h, i, j) {
    super(a, b, c, d, e, f, g, h, i, j);
  }
  show() { return "OverArray " + this.length + " " + this.join(""); }
}
const holder = { made: [OverFunction, OverClass, OverDerived, OverArray] };
const said = new Set();
const before = count("operationAOTSuperConstruct");
let known = "";
for (let turn = 0; turn < 500; turn++) {
  if (turn === 50) known = countsSoFar();
  for (const callee of holder.made.slice(0, 3)) {
    said.add(new callee(1, 2, 3, 4, 5, 6, 7, 8, 9, 0, "k").show());
    said.add(new callee(1, 2, 3, 4, 5).show());
  }
}
const inRunTime = count("operationAOTSuperConstruct") - before + callsIn(countsSoFar(), ...owed) - callsIn(known, ...owed);
console.log([...said].join("\n"));
console.log(inRunTime === 0 ? "the run time called no parent" : "the run time called a parent " + inRunTime + " times");
console.log(new holder.made[3](1, 2, 3, 4, 5, 6, 7, 8, 9, 0).show());
console.log(new OverAsksTarget(1, 2, 3, 4, 5, 6, 7, 8, 9, 0).show(), Reflect.construct(OverAsksTarget, [1, 2], OverClass).target);

// A parent that is swapped, is no constructor, returns another object, throws.
Object.setPrototypeOf(OverFunction, function Swapped(a, b, c, d, e, f, g, h, i, j) { this.swapped = [a, j, arguments.length].join(); });
console.log(Object.keys(new OverFunction(1, 2, 3, 4, 5, 6, 7, 8, 9, 0)).join(), new OverFunction(1, 2, 3, 4, 5, 6, 7, 8, 9, 0).swapped);
Object.setPrototypeOf(OverFunction, function Replaces() { return { replaced: arguments.length }; });
console.log(JSON.stringify(new OverFunction(1, 2, 3, 4, 5, 6, 7, 8, 9, 0)));
Object.setPrototypeOf(OverFunction, () => 1);
try {
  new OverFunction(1, 2, 3, 4, 5, 6, 7, 8, 9, 0);
} catch (error) {
  console.log(error.constructor.name);
}
Object.setPrototypeOf(OverFunction, function Throws(a, b, c, d, e, f, g, h, i, j) { throw new RangeError("from the parent " + j); });
try {
  new OverFunction(1, 2, 3, 4, 5, 6, 7, 8, 9, 0);
} catch (error) {
  console.log(error.message);
}
Object.setPrototypeOf(OverFunction, new Proxy(Request, { construct(target, list, newTarget) { return Reflect.construct(target, list.slice().reverse(), newTarget); } }));
console.log(new OverFunction(1, 2, 3, 4, 5, 6, 7, 8, 9, 0).show());
Object.setPrototypeOf(OverFunction, Request);
console.log(Reflect.construct(OverFunction, [1, 2, 3, 4, 5, 6, 7, 8, 9, 0], OverClass).show());
console.log(Reflect.construct(OverClass, [1, 2, 3, 4, 5, 6, 7, 8, 9, 0], OverFunction).show());
