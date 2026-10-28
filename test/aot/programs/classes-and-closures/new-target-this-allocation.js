// `this` of a base constructor gets its prototype from new.target: new C, new D, and Reflect.construct with a subclass, a plain function or a Proxy as new.target, 10,000 times each across forced collections. Halfway the prototypes change. A new.target whose `prototype` getter throws does not affect later objects. constructAny constructs a value that is only known at run time.
// CALLS+ constructAny CreateThis
class C {
  x = 1;
  constructor(y) { this.y = y; }
  get kind() { return "C"; }
}
class D extends C {
  z = 3;
}
function Plain(y) { this.y = y; }
Plain.prototype.kind = "Plain";
function constructAny(constructor, y) { return new constructor(y); }

const plainTarget = function () {};
const firstPrototype = plainTarget.prototype;
firstPrototype.kind = "first";
const secondPrototype = { kind: "second" };
const replacement = { kind: "replacement" };

const throwing = new Proxy(function () {}, {
  get(target, key, receiver) {
    if (key === "prototype") throw new RangeError("the prototype getter threw");
    return Reflect.get(target, key, receiver);
  },
});
let reads = 0;
const alternating = new Proxy(function () {}, {
  get(target, key, receiver) {
    if (key === "prototype") return ++reads % 2 ? firstPrototype : secondPrototype;
    return Reflect.get(target, key, receiver);
  },
});

const tally = new Map();
function count(line) {
  tally.set(line, (tally.get(line) ?? 0) + 1);
}
function record(label, object, prototype) {
  count(`${label}: ${Object.getPrototypeOf(object) === prototype} ${object.kind} ${JSON.stringify(object)}`);
}

for (let round = 0; round < 10_000; round++) {
  if (round === 5_000) {
    Object.setPrototypeOf(D.prototype, replacement);
    plainTarget.prototype = secondPrototype;
  }
  const y = round % 2;
  record("new C", new C(y), C.prototype);
  record("new D", new D(y), D.prototype);
  record("C with D", Reflect.construct(C, [y], D), D.prototype);
  record("C with plainTarget", Reflect.construct(C, [y], plainTarget), plainTarget.prototype);
  record("Plain with plainTarget", Reflect.construct(Plain, [y], plainTarget), plainTarget.prototype);
  record("new Plain", new Plain(y), Plain.prototype);
  for (const constructor of [C, D, Plain]) record(`constructAny ${constructor.name}`, constructAny(constructor, y), constructor.prototype);
  record("C with alternating", Reflect.construct(C, [y], alternating), reads % 2 ? firstPrototype : secondPrototype);
  if (round % 1_000 === 999) {
    Bun.gc(true);
    for (const constructor of [C, Plain]) {
      try {
        record(`${constructor.name} with throwing`, Reflect.construct(constructor, [y], throwing), null);
      } catch (error) {
        count(`${constructor.name} with throwing: ${error.name}: ${error.message}`);
      }
    }
  }
}
for (const [line, times] of tally) console.log(times, line);
console.log("prototype reads through the Proxy", reads);
console.log(new D(0) instanceof C, new D(0) instanceof D, Reflect.construct(C, [0], D) instanceof D, Reflect.construct(C, [0], plainTarget) instanceof C);

plainTarget.prototype = 5;
for (const constructor of [C, Plain]) {
  const object = Reflect.construct(constructor, [7], plainTarget);
  console.log(constructor.name, "with a prototype that is not an object", Object.getPrototypeOf(object) === Object.prototype, JSON.stringify(object));
}

let matches = 0;
for (let round = 0; round < 1_000; round++) {
  const fresh = function () {};
  if (Object.getPrototypeOf(Reflect.construct(C, [round], fresh)) === fresh.prototype) matches++;
  if (Object.getPrototypeOf(Reflect.construct(Plain, [round], fresh)) === fresh.prototype) matches++;
}
console.log("objects with the prototype of a fresh new.target", matches);
