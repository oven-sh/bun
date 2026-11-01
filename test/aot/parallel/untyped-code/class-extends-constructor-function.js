// A class that extends a constructor function, constructed where the compiler does not see who new.target is. Only the jsc shell can count.
// Env: JSC_aotCountsPath=/dev/null
const counts = typeof aotOperationCount === "function";
const count = counts ? aotOperationCount : () => 0;
function Point(x, y) {
  this.x = x;
  this.y = y;
}
Point.prototype.kind = "point";
function Asks(value) {
  this.value = value;
  this.target = new.target.name;
}
Asks.prototype.kind = "asks";
function Other() {}
Other.prototype.kind = "other";
function Replaces() {
  return { replaced: true, kind: "replaced" };
}
class Heir extends Point {
  constructor(x, y) { super(x, y); this.z = 0; }
  get kind() { return "heir of " + super.kind; }
}
class Below extends Heir {
  get kind() { return "below, " + super.kind; }
}
class Lowest extends Below {
  constructor(...rest) { super(...rest); this.w = 1; }
}
class Beside extends Point {
  get kind() { return "beside"; }
}
class HeirOfAsks extends Asks {}
class HeirOfReplaces extends Replaces {
  constructor() { super(); this.added = true; }
}
class A extends Point {}
class B extends Point {}
class C extends Point {}
class D extends Point {}
class E extends Point {}
function describe(object) {
  return Object.keys(object).map(key => key + "=" + object[key]).join() + " " + object.kind + " " + Object.getPrototypeOf(object).constructor.name;
}

const many = [A, B, C, D, E, Heir, Below, Lowest, HeirOfAsks];
const boundHeir = Heir.bind(null, 1);
const boundLowest = Lowest.bind(null);
const said = new Set();
for (const each of many) describe(new each(0, 0));
describe(new boundHeir(0));
describe(new boundLowest(0, 0));
const before = count("operationAOTCreateThis");
for (let i = 0; i < 2000; i++) {
  said.add(describe(new many[i % many.length](1, 2)));
  said.add(describe(Reflect.construct(many[i % many.length], [3, 4])));
  said.add(describe(new boundHeir(5)));
  said.add(describe(new boundLowest(6, 7)));
  said.add(describe(new Heir(8, 9)));
  said.add(describe(new Below(10, 11)));
  said.add(describe(new Lowest(12, 13)));
  said.add(describe(new HeirOfAsks(14)));
}
const asked = count("operationAOTCreateThis") - before;
console.log([...said].join("\n"));
console.log(asked === 0 ? "the run time was never asked what `this` is made of" : "the run time was asked what `this` is made of " + asked + " times");

console.log(describe(new HeirOfReplaces()));
console.log(describe(Reflect.construct(Heir, [1, 2], Other)));
console.log(describe(Reflect.construct(Heir, [1, 2], Beside)));
console.log(describe(Reflect.construct(Heir, [1, 2], Point)));
console.log(describe(Reflect.construct(Beside, [1, 2], Heir)));
console.log(describe(Reflect.construct(Heir, [1, 2], Lowest)));
console.log(describe(Reflect.construct(HeirOfAsks, [1], Other)));
console.log(!counts || count("operationAOTCreateThis") > before ? "a new.target beside the class is left to the run time" : "nothing was counted");

const log = [];
const watched = new Proxy(Heir, { get(target, key, receiver) { log.push("get " + String(key)); return Reflect.get(target, key, receiver); } });
for (let i = 0; i < 3; i++) console.log(describe(Reflect.construct(Heir, [1, 2], watched)), describe(new watched(3, 4)));
console.log(log.join());
let reads = 0;
const target = Object.defineProperty(function () {}.bind(), "prototype", { get() { reads++; return reads % 2 ? Other.prototype : 7; } });
for (let i = 0; i < 4; i++) console.log(reads, Object.getPrototypeOf(Reflect.construct(Heir, [1, 2], target)) === (i % 2 ? Object.prototype : Other.prototype));

Point.prototype = { kind: "second" };
console.log(describe(new Heir(1, 2)), new Point(1, 2).kind);
Object.setPrototypeOf(Heir.prototype, Other.prototype);
console.log(new Heir(1, 2).kind, new Lowest(1, 2).kind);
Object.setPrototypeOf(Heir, Asks);
console.log(describe(new Heir(1, 2)), describe(new boundLowest(3, 4)), describe(Reflect.construct(Heir, [5], Other)));
Object.setPrototypeOf(Heir, Replaces);
console.log(describe(new Heir(1, 2)), describe(new Below(3, 4)));
Object.setPrototypeOf(Heir, null);
try {
  new Heir(1, 2);
} catch (error) {
  console.log(error.constructor.name);
}
for (const notConstructor of [() => 1, Math.max, {}, undefined]) {
  try {
    Reflect.construct(Beside, [], notConstructor);
  } catch (error) {
    console.log(error.constructor.name);
  }
}

let kept = [];
for (let i = 0; i < 20000; i++) {
  const object = new many[i % 5](i, new Array(8).fill(i));
  if (i % 1000 === 0) kept.push(object);
}
console.log(kept.map(object => object.x + ":" + object.y[7] + ":" + object.kind).join(" "));
