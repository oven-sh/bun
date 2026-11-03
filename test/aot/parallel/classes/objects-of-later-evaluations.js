// Each evaluation of a class has a class object and a prototype object of its own. What is done to those of a later evaluation shows in its objects alone.
const lines = [];
const say = (...parts) => lines.push(parts.join(" "));

class Root {
  constructor() {
    this.root = new.target.name;
  }
  who() {
    return "root";
  }
}

function make(tag) {
  class Other extends Root {
    constructor() {
      super();
      this.tag = tag;
    }
    method() {
      return "method " + this.tag;
    }
    static made() {
      return "made " + tag;
    }
  }
  class Derived extends Other {}
  return { Other, Derived };
}

const pairs = [];
for (let i = 0; i < 40; i++) pairs.push(make(i));

for (const i of [0, 1, 2, 39]) {
  const { Other, Derived } = pairs[i];
  const object = new Derived();
  say(i, object.root, object.tag, object.method(), object.who(), Derived.made(), Object.keys(object).join());
  say(i, Object.getPrototypeOf(object) === Derived.prototype, Object.getPrototypeOf(Derived.prototype) === Other.prototype, Object.getPrototypeOf(Derived) === Other);
  say(i, object instanceof pairs[0].Other, object instanceof Other, object.constructor === Derived, Derived.prototype.constructor === Derived);
}

// A member put on the prototype object of one evaluation.
pairs[3].Other.prototype.method = function () {
  return "replaced " + this.tag;
};
pairs[4].Derived.prototype.extra = 4;
Object.defineProperty(pairs[5].Other.prototype, "tag", { set(value) { say("setter", value); }, get() { return "got"; }, configurable: true });
for (const i of [2, 3, 4, 5, 6]) {
  const object = new pairs[i].Derived();
  say(i, object.method(), object.extra, object.tag, Object.keys(object).join());
}

// A member put on the class object of one evaluation, and another parent for it.
pairs[7].Other.made = () => "made otherwise";
Object.setPrototypeOf(pairs[8].Derived, pairs[9].Other);
Object.setPrototypeOf(pairs[10].Derived.prototype, pairs[11].Other.prototype);
pairs[11].Other.prototype.method = () => "method of eleven";
for (const i of [6, 7, 8, 10]) say(i, pairs[i].Derived.made(), new pairs[i].Derived().method());

// The prototype object no longer names its class.
pairs[12].Derived.prototype.constructor = Root;
delete pairs[13].Derived.prototype.constructor;
Object.defineProperty(pairs[14].Derived.prototype, "constructor", { get() { return pairs[15].Derived; } });
pairs[16].Derived.prototype.constructor = pairs[17].Derived;
for (const i of [12, 13, 14, 16]) {
  const object = new pairs[i].Derived();
  say(i, object.tag, object.method(), object.constructor.name, Object.getPrototypeOf(object) === pairs[i].Derived.prototype, Object.keys(object).join());
}

// The prototype object of a later evaluation is the prototype property of a function.
function Plain() {
  this.plain = true;
}
Plain.prototype = pairs[18].Derived.prototype;
const plain = new Plain();
say(plain.plain, plain.method(), plain instanceof pairs[18].Other, Object.keys(plain).join());
say(new pairs[18].Derived().method(), Object.keys(new pairs[18].Derived()).join());

function Target() {}
Target.prototype = pairs[19].Derived.prototype;
for (const constructor of [Root, pairs[19].Other, pairs[20].Other, pairs[20].Derived]) {
  const object = Reflect.construct(constructor, [], Target);
  say(object.root, object.tag, object.method(), Object.getPrototypeOf(object) === pairs[19].Derived.prototype, Object.keys(object).join());
}
const crossed = Reflect.construct(pairs[21].Derived, [], pairs[22].Derived);
say(crossed.tag, crossed.method(), crossed instanceof pairs[22].Other, crossed instanceof pairs[21].Other);

// The class object of a later evaluation is a prototype itself.
function Below() {}
Below.prototype = pairs[23].Derived;
say(new Below().made(), typeof new Below().prototype, Object.create(pairs[24].Other).made());

// Frozen holders, and names listed.
Object.freeze(pairs[25].Other.prototype);
Object.freeze(pairs[25].Other);
say(new pairs[25].Derived().method(), Object.isFrozen(pairs[25].Other.prototype), Object.isFrozen(pairs[26].Other.prototype));
for (const i of [0, 27]) {
  say(Object.getOwnPropertyNames(pairs[i].Other).join(), Object.getOwnPropertyNames(pairs[i].Other.prototype).join(), Object.getOwnPropertyNames(pairs[i].Derived).join(), Object.getOwnPropertyNames(pairs[i].Derived.prototype).join());
  say(JSON.stringify(Object.getOwnPropertyDescriptor(pairs[i].Derived, "prototype")), JSON.stringify(Object.getOwnPropertyDescriptor(pairs[i].Derived.prototype, "constructor")));
}

// Many evaluations, with collections among them.
let sum = 0;
for (let i = 0; i < 30000; i++) {
  const { Other, Derived } = make(i);
  if (i % 1000 === 0) {
    Other.prototype.method = function () {
      return this.tag + 1;
    };
    sum += new Derived().method();
  } else if (i % 7 === 0) sum += new Derived().tag;
  if (i % 10000 === 9999) Bun.gc(true);
}
say(sum);

// What a class extends need not be a class of the program.
function extend(parent) {
  return class extends parent {
    here() {
      return "here";
    }
  };
}
for (const parent of [Array, Map, Error, Object, function () {}, pairs[28].Derived, pairs[28].Derived, pairs[29].Derived, null]) {
  const made = extend(parent);
  say(parent === null ? "null" : parent.name || "function", Object.getPrototypeOf(made) === (parent ?? Function.prototype), Object.getPrototypeOf(made.prototype) === (parent === null ? null : parent.prototype), made.prototype.here());
}
for (const wrong of [1, "text", {}, () => {}, Symbol.iterator, Object.assign(function () {}, { prototype: 3 })]) {
  try {
    extend(wrong);
    say("extended");
  } catch (error) {
    say(error.constructor.name, error.message);
  }
}
const bound = pairs[30].Derived.bind(null);
say(typeof bound.prototype);
try {
  say(Object.getPrototypeOf(extend(bound).prototype) === undefined);
} catch (error) {
  say(error.constructor.name, error.message);
}
const proxied = new Proxy(pairs[31].Derived, { get(target, key, receiver) { if (key === "prototype") say("asked for the prototype"); return Reflect.get(target, key, receiver); } });
say(new (extend(proxied))().method());

console.log(lines.join("\n"));
