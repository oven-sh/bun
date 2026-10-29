import { Core, OtherBase, Small, readLate, hasLate, readMore, readLateOfSmall, hasLateOfSmall, readLateOfOther, hasLateOfOther, TypedTarget, TypedTargetForSmall, TypedTargetForOther, makeTypedTarget, PointForCore, PointForSmall, PointForOther, points } from "./core.ts";

const warm = 24;
const nameOfLate = ["la", "te"].join("");
const nameOfPrototype = ["proto", "type"].join("");
const collect = typeof Bun !== "undefined" ? () => Bun.gc(true) : typeof gc === "function" ? () => gc() : () => {};

function below(parent, kind) {
  return Object.create(parent, { kind: { value: kind, configurable: true } });
}
function look(o) {
  const typed = o instanceof Core ? [readLate(o), hasLate(o), readMore(o)] : o instanceof Small ? [readLateOfSmall(o), hasLateOfSmall(o)] : o instanceof OtherBase ? [readLateOfOther(o), hasLateOfOther(o)] : [];
  let stored;
  const before = [o.ownLate(), o.hasLate()];
  try {
    o.setLate("stored");
    stored = [o.ownLate(), o.caught];
  } catch (error) {
    stored = error.constructor.name;
  }
  return JSON.stringify([o.kind, o.describe(), Object.keys(o).join(), o instanceof Core, o instanceof OtherBase, o instanceof Small, typed, before, stored]);
}
function lookFromOutside(o) {
  return JSON.stringify([o.kind, Object.keys(o).join(), o.count, o instanceof Core, o instanceof OtherBase, o instanceof Small]);
}
function says(label, make, prototypeNow, looks = look) {
  const said = new Set();
  for (let i = 0; i < 3; i++) {
    const o = make(i);
    said.add((prototypeNow ? Object.getPrototypeOf(o) === prototypeNow() : "-") + " " + looks(o).replace(/-?\d+/g, "n"));
  }
  console.log(label, said.size, [...said].join(" || "));
}
function warmUp(make) {
  let sum = 0;
  for (let i = 0; i < warm; i++) sum += make(i).count;
  return sum;
}

function functionsAsTargets(Base, nameOfBase, Another, typedTarget, constructorFunction) {
  const targets = {
    "a function": function Old() {},
    "a function that captures": (() => { let calls = 0; return function Capturing() { return ++calls; }; })(),
    "a function of typed code": typedTarget,
    "a constructor function of typed code": constructorFunction,
    "a function of typed code that captures": makeTypedTarget("k"),
  };
  for (const kindOfTarget in targets) {
    const label = nameOfBase + ", " + kindOfTarget;
    const T = targets[kindOfTarget];
    const make = i => Reflect.construct(Base, [i], T);
    const now = () => (typeof T.prototype === "object" && T.prototype !== null ? T.prototype : Object.prototype);
    T.prototype = below(Base.prototype, "first");
    warmUp(make);
    says(label + ", at first", make, now);
    T.prototype = below(Base.prototype, "stored");
    says(label + ", stored to", make, now);
    warmUp(make);
    T[nameOfPrototype] = below(Base.prototype, "stored under a key");
    says(label + ", stored to under a key", make, now);
    warmUp(make);
    Object.defineProperty(T, "prototype", { value: below(Base.prototype, "defined") });
    says(label + ", defined", make, now);
    warmUp(make);
    Reflect.set(T, "prototype", below(Base.prototype, "set by Reflect"));
    says(label + ", set by Reflect", make, now);
    warmUp(make);
    Object.assign(T, { prototype: below(Base.prototype, "assigned") });
    says(label + ", assigned", make, now);
    warmUp(make);
    T.prototype = below(Another.prototype, "below the other base");
    says(label + ", below the other base", make, now, lookFromOutside);
    warmUp(make);
    T.prototype = below(null, "below nothing");
    const bare = make(1);
    console.log(label + ", below nothing", Object.getPrototypeOf(bare) === T.prototype, Object.keys(bare).join(), bare.kind, bare instanceof Base);
    warmUp(make);
    T.prototype = 5;
    says(label + ", no object", make, null, lookFromOutside);
    console.log(label + ", no object", Object.getPrototypeOf(make(1)) === Object.prototype);
    T.prototype = below(Base.prototype, "again");
    warmUp(make);
    Object.defineProperty(T, "prototype", { value: below(Base.prototype, "fixed"), writable: false });
    says(label + ", fixed", make, now);
  }
}

function prototypesOfHeirs(Heir, Base, Another, an) {
  const make = i => new Heir(i);
  const now = () => Heir.prototype;
  warmUp(make);
  says(an + ", at first", make, now);
  Heir.prototype.extra = 1;
  says(an + ", a property on its prototype", make, now);
  warmUp(make);
  Heir.prototype[nameOfLate] = "inherited";
  says(an + ", a declared name on its prototype", make, now);
  warmUp(make);
  delete Heir.prototype[nameOfLate];
  says(an + ", taken away again", make, now);
  warmUp(make);
  Object.defineProperty(Heir.prototype, nameOfLate, { get() { return "got"; }, set(value) { this.caught = value; }, configurable: true });
  says(an + ", an accessor", make, now);
  warmUp(make);
  delete Heir.prototype[nameOfLate];
  says(an + ", without it", make, now);
  warmUp(make);
  const between = below(Base.prototype, "between");
  Object.defineProperty(between, nameOfLate, { get() { return "from between"; }, configurable: true });
  Object.setPrototypeOf(Heir.prototype, between);
  says(an + ", another object above its prototype", make, now);
  warmUp(make);
  delete between[nameOfLate];
  says(an + ", that object changed", make, now);
  warmUp(make);
  between[nameOfLate] = "data from between";
  says(an + ", that object changed again", make, now);
  warmUp(make);
  Object.setPrototypeOf(Heir.prototype, Base.prototype);
  says(an + ", back below the class", make, now);
  warmUp(make);
  Object.setPrototypeOf(Heir, Another);
  Object.setPrototypeOf(Heir.prototype, Another.prototype);
  says(an + ", of the other base now", make, now);
  warmUp(make);
  Object.setPrototypeOf(Heir, Base);
  says(an + ", constructed by the class, inheriting from the other base", make, now, lookFromOutside);
  Object.setPrototypeOf(Heir.prototype, Base.prototype);
  says(an + ", as at first", make, now);
}

function targetsThatAnswerAnew(Base, nameOfBase) {
  const prototypes = [below(Base.prototype, "zero"), below(Base.prototype, "one"), below(Base.prototype, "two")];
  let asked = 0;
  const bound = Base.bind(null);
  Object.defineProperty(bound, "prototype", { get() { return prototypes[asked++ % 3]; }, configurable: true });
  const proxied = new Proxy(function () {}, { get(target, key, receiver) { return key === "prototype" ? prototypes[asked++ % 3] : Reflect.get(target, key, receiver); } });
  const withGetter = Object.defineProperty(function () {}.bind(null), "prototype", { get() { return prototypes[asked++ % 3]; } });
  for (const [label, T] of [["bound", bound], ["proxied", proxied], ["bound, with a getter", withGetter]]) {
    const kinds = [];
    for (let i = 0; i < 9; i++) kinds.push(Reflect.construct(Base, [i], T).kind);
    console.log(nameOfBase, label, kinds.join());
  }
}

function targetsInTurn(Base, nameOfBase, makeHeir, read, keys) {
  for (const number of [1, 2, 15, 16, 17, 40]) {
    const targets = [];
    for (let i = 0; i < number; i++) {
      if (i % 3 === 2) {
        const T = function () {};
        T.prototype = below(Base.prototype, "function " + i);
        targets.push(T);
      } else
        targets.push(makeHeir(i));
    }
    let wrong = 0;
    for (let round = 0; round < 6; round++) {
      for (let i = 0; i < number; i++) {
        const o = Reflect.construct(Base, [i], targets[i]);
        wrong += Object.getPrototypeOf(o) !== targets[i].prototype || (i % 3 === 2 ? o.kind !== "function " + i : o.constructor !== targets[i]) || Math.abs(o.count) !== i || Object.keys(o).join() !== keys;
      }
      if (round === 2) {
        for (let i = 2; i < number; i += 3) targets[i].prototype = below(Base.prototype, "function " + i);
      }
      if (round === 3) {
        for (let i = 0; i < number; i += 3) Object.defineProperty(targets[i].prototype, nameOfLate, { get() { return "late " + i; }, configurable: true });
      }
      if (round >= 3) {
        for (let i = 0; i < number; i++) wrong += read(Reflect.construct(Base, [i], targets[i])) !== (i % 3 ? undefined : "late " + i);
      }
    }
    console.log(nameOfBase, number + " targets in turn, wrong:", wrong);
  }
}

function heirsThatDie(nameOfBase, makeHeir, read) {
  let wrong = 0;
  for (let generation = 0; generation < 60; generation++) {
    let Heir = makeHeir(generation);
    if (generation % 3 === 1) Object.defineProperty(Heir.prototype, nameOfLate, { get() { return generation; }, configurable: true });
    for (let i = 0; i < 8; i++) {
      const o = new Heir(i);
      wrong += o.constructor !== Heir || Object.getPrototypeOf(o) !== Heir.prototype || read(o) !== (generation % 3 === 1 ? generation : undefined) || Math.abs(o.count) !== i;
    }
    Heir = null;
    if (generation % 2) collect();
  }
  console.log(nameOfBase, "heirs that die, wrong:", wrong);
}

class HeirOfCore extends Core {
  helper() { return "helper"; }
}
class BareHeirOfCore extends Core {}
class HeirOfOther extends OtherBase {
  helper() { return "helper"; }
}
class BareHeirOfOther extends OtherBase {}
class HeirOfSmall extends Small {
  helper() { return "helper"; }
}
class BareHeirOfSmall extends Small {}

export function run() {
  console.log("points", points());
  functionsAsTargets(Core, "Core", OtherBase, TypedTarget, PointForCore);
  functionsAsTargets(Small, "Small", OtherBase, TypedTargetForSmall, PointForSmall);
  functionsAsTargets(OtherBase, "OtherBase", Small, TypedTargetForOther, PointForOther);
  prototypesOfHeirs(HeirOfCore, Core, OtherBase, "an heir of Core");
  prototypesOfHeirs(BareHeirOfCore, Core, OtherBase, "a bare heir of Core");
  prototypesOfHeirs(HeirOfSmall, Small, OtherBase, "an heir of Small");
  prototypesOfHeirs(BareHeirOfSmall, Small, OtherBase, "a bare heir of Small");
  prototypesOfHeirs(HeirOfOther, OtherBase, Small, "an heir of OtherBase");
  prototypesOfHeirs(BareHeirOfOther, OtherBase, Small, "a bare heir of OtherBase");
  targetsThatAnswerAnew(Core, "Core");
  targetsThatAnswerAnew(Small, "Small");
  targetsInTurn(Core, "Core", () => class extends Core {}, readLate, "count,label,list");
  targetsInTurn(Small, "Small", () => class extends Small {}, readLateOfSmall, "count");
  targetsInTurn(OtherBase, "OtherBase", () => class extends OtherBase {}, readLateOfOther, "other,count");
  heirsThatDie("Core", () => class extends Core {}, readLate);
  heirsThatDie("Small", () => class extends Small {}, readLateOfSmall);
  heirsThatDie("OtherBase", () => class extends OtherBase {}, readLateOfOther);
}
