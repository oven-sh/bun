// Constructor functions with no `this.x = ..` and no `F.prototype.x = ..`. Each is constructed several times before and after every change, so a cached allocation would show.
const lines = [];
function report(label, ...values) {
  lines.push(label + ": " + values.map(String).join(" "));
}
function describe(F, expected) {
  let matches = 0;
  for (let i = 0; i < 6; i++) {
    const made = new F({ a: i });
    if (Object.getPrototypeOf(made) === expected) matches++;
  }
  return matches;
}

function Assigned(from) { Object.assign(this, from); }
const firstAssigned = Assigned.prototype;
report("as created", describe(Assigned, firstAssigned), new Assigned({ a: 1 }) instanceof Assigned, new Assigned({ a: 2 }).a);
const second = { tag: "second" };
Assigned.prototype = second;
report("after a store", describe(Assigned, second), describe(Assigned, firstAssigned), new Assigned({}).tag);
Assigned.prototype = firstAssigned;
report("stored back", describe(Assigned, firstAssigned), describe(Assigned, second));

function Defined() {}
report("defined, before", describe(Defined, Defined.prototype));
const third = { tag: "third" };
Object.defineProperty(Defined, "prototype", { value: third });
report("Object.defineProperty", describe(Defined, third), new Defined().tag);
const fourth = { tag: "fourth" };
report("Reflect.defineProperty", Reflect.defineProperty(Defined, "prototype", { value: fourth }), describe(Defined, fourth));
const fifth = { tag: "fifth" };
report("Reflect.set", Reflect.set(Defined, "prototype", fifth), describe(Defined, fifth));
const sixth = { tag: "sixth" };
Object.assign(Defined, { prototype: sixth });
report("Object.assign", describe(Defined, sixth));
const key = ["proto", "type"].join("");
const seventh = { tag: "seventh" };
Defined[key] = seventh;
report("a computed key", describe(Defined, seventh));

function Primitive() {}
report("primitive, before", describe(Primitive, Primitive.prototype));
for (const value of [1, "text", null, undefined, true, Symbol.iterator, 10n]) {
  Primitive.prototype = value;
  report("prototype is " + typeof value, describe(Primitive, Object.prototype));
}
const eighth = { tag: "eighth" };
Primitive.prototype = eighth;
report("an object again", describe(Primitive, eighth));

function Locked() {}
report("locked, before", describe(Locked, Locked.prototype));
const lockedPrototype = Locked.prototype;
Object.defineProperty(Locked, "prototype", { writable: false });
let refusal = "stored";
try { Locked.prototype = { tag: "refused" }; } catch (error) { refusal = error.constructor.name; }
report("read-only", refusal, describe(Locked, lockedPrototype), Reflect.set(Locked, "prototype", {}));
Object.freeze(Locked);
report("frozen", describe(Locked, lockedPrototype));

function Crowded() {}
report("crowded, before", describe(Crowded, Crowded.prototype));
for (let i = 0; i < 200; i++) Crowded["p" + i] = i;
report("many properties", describe(Crowded, Crowded.prototype));
for (let i = 0; i < 200; i += 2) delete Crowded["p" + i];
report("after deletions", describe(Crowded, Crowded.prototype));
const ninth = { tag: "ninth" };
Crowded.prototype = ninth;
report("stored on a dictionary", describe(Crowded, ninth));
Crowded.later = 1;
const tenth = { tag: "tenth" };
Crowded.prototype = tenth;
report("stored again", describe(Crowded, tenth));

function make() { return function Made() {}; }
const made = [make(), make(), make()];
report("closures of one function", made.map(F => describe(F, F.prototype)).join(","), made[0].prototype === made[1].prototype);
made[1].prototype = second;
report("one of them changed", made.map((F, i) => describe(F, i === 1 ? second : F.prototype)).join(","));
let mixed = 0;
for (let i = 0; i < 30; i++) {
  const F = made[i % 3];
  if (Object.getPrototypeOf(new F()) === F.prototype) mixed++;
}
report("taken in turn", mixed);

function Target() {}
function Other() {}
report("targets, before", describe(Target, Target.prototype), describe(Other, Other.prototype));
let reflected = 0;
for (let i = 0; i < 12; i++) {
  const viaOther = Reflect.construct(Target, [], Other);
  const viaSelf = Reflect.construct(Target, [], Target);
  const plain = new Target();
  if (Object.getPrototypeOf(viaOther) === Other.prototype && Object.getPrototypeOf(viaSelf) === Target.prototype && Object.getPrototypeOf(plain) === Target.prototype) reflected++;
}
report("Reflect.construct", reflected);
class Below extends Target {}
report("a class below", describe(Below, Below.prototype), new Below() instanceof Target);
const bound = Target.bind(null);
report("bound", Object.getPrototypeOf(new bound()) === Target.prototype, Object.getPrototypeOf(Reflect.construct(bound, [], Other)) === Other.prototype);
const proxied = new Proxy(Target, {});
report("through a proxy", Object.getPrototypeOf(new proxied()) === Target.prototype);
let reads = 0;
const counting = new Proxy(Target, { get(target, name, receiver) { if (name === "prototype") reads++; return Reflect.get(target, name, receiver); } });
for (let i = 0; i < 5; i++) new counting();
report("reads of prototype through a proxy", reads);

function Collected() {}
let survived = 0;
for (let round = 0; round < 4; round++) {
  const replacement = { round };
  Collected.prototype = replacement;
  for (let i = 0; i < 4; i++) if (Object.getPrototypeOf(new Collected()) === replacement) survived++;
  Bun.gc(true);
  for (let i = 0; i < 4; i++) if (Object.getPrototypeOf(new Collected()) === replacement) survived++;
}
report("across collections", survived);

function Inherits() {}
Object.setPrototypeOf(Inherits, { prototype: { tag: "inherited" } });
report("its own prototype property wins", describe(Inherits, Inherits.prototype), new Inherits().tag);

function Returns(value) { return value; }
const handed = { tag: "handed" };
report("returns another object", new Returns(handed) === handed, Object.getPrototypeOf(new Returns(1)) === Returns.prototype, Object.getPrototypeOf(new Returns(1)) === Returns.prototype);

function Changing() { Changing.prototype = Changing.next; }
Changing.next = { tag: "next" };
const before = Changing.prototype;
const one = new Changing();
const two = new Changing();
Changing.next = { tag: "after" };
const three = new Changing();
const four = new Changing();
report("changed by the constructor itself", Object.getPrototypeOf(one) === before, two.tag, three.tag, four.tag);

console.log(lines.join("\n"));
