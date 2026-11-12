// Static properties added to classes that are evaluated once, twice and many times.
const say = (...values) => console.log(...values.map(value => (typeof value === "string" ? value : JSON.stringify(value))));
const attempt = body => {
  try {
    return body();
  } catch (error) {
    return error.constructor.name + ": " + error.message;
  }
};
const own = object => Reflect.ownKeys(object).map(String).join();

function plainFactory() { return class { }; }
function namedFactory() { return class Named { m() { return 1; } static s() { return "static"; } }; }
function fieldFactory(i) { return class { static declared = i; instance = i; }; }
function accessorFactory() { let kept; return class { static get computed() { return kept; } static set computed(value) { kept = [value]; } }; }
class Root { static inherited = "root"; static get guarded() { return "got"; } static set guarded(value) { this.stored = value; } m() { return "root"; } }
Object.defineProperty(Root, "fixed", { value: "fixed", writable: false });
function mixin(Base) { return class extends Base { m() { return "mixin " + super.m(); } }; }
function emptyMixin(Base) { return class extends Base { }; }
function nullHeir() { return class extends null { }; }
const key = "computed" + "Key";
function computedFactory(i) { return class { static [key] = i; static ["m" + i]() {} }; }
function blockFactory() { return class { static { this.fromBlock = "block"; } }; }
function privateFactory() { return class { static #hidden = 1; static peek() { return this.#hidden; } }; }

const factories = { plainFactory, namedFactory, fieldFactory, accessorFactory, mixinOfRoot: () => mixin(Root), emptyMixinOfRoot: () => emptyMixin(Root), mixinOfPlain: () => emptyMixin(plainFactory()), nullHeir, computedFactory, blockFactory, privateFactory };

function add(object, i) {
  object.tag = i;
  object.other = [i];
  return object;
}
for (const [name, make] of Object.entries(factories)) {
  let last;
  for (let i = 0; i < 60; i++) last = add(make(i), i);
  say(name, own(last).replace(/m\d+/, "m#"), last.tag, last.other, last.name, last.length);
}

// The names that a class declares, inherits or treats apart.
const names = ["tag", "declared", "computed", "computedKey", "s", "inherited", "guarded", "fixed", "name", "length", "prototype", "caller", "arguments", "displayName", "toString", "call", "constructor", "0", "then", "__proto__", "fromBlock", "peek", "hasOwnProperty"];
for (const [name, make] of Object.entries(factories)) {
  for (const key of names) {
    let found;
    for (let i = 0; i < 5; i++) {
      const made = make(i);
      const result = attempt(() => { made[key] = "value" + i; });
      found = [result === undefined ? "stored" : result.split(":")[0], Object.hasOwn(made, key), attempt(() => typeof made[key]).split(":")[0], own(made).replace(/m\d+/, "m#").length];
    }
    say(name, key, found);
  }
}

// One site for each name, so that each is cached apart.
const sites = [
  object => { object.schema = 1; return object.schema; },
  object => { object.declared = 2; return object.declared; },
  object => { object.guarded = 3; return object.guarded; },
  object => { object.inherited = 4; return object.inherited; },
  object => { object.s = 5; return typeof object.s; },
  object => { object.computed = 6; return object.computed; },
];
for (const [name, make] of Object.entries(factories)) {
  const found = sites.map(site => {
    let last;
    for (let i = 0; i < 30; i++) last = attempt(() => site(make(i)));
    return last;
  });
  say("site", name, found, Root.stored === undefined, Root.inherited);
}
// The sites above in the other order of kinds.
for (const site of sites) {
  const found = [];
  for (let i = 0; i < 55; i++) {
    const [, make] = Object.entries(factories)[i % 11];
    const result = attempt(() => site(make(i)));
    if (i >= 44) found.push(result);
  }
  say("mixed", found);
}

// A static setter or read-only static comes later, above a class that is made again.
for (let round = 0; round < 3; round++) {
  const seen = [];
  class Late { }
  const make = () => class extends Late { };
  const store = object => { object.late = seen.length; return Object.hasOwn(object, "late"); };
  let ownCount = 0;
  for (let i = 0; i < 40; i++) {
    if (i === 20) Object.defineProperty(Late, "late", { set(value) { seen.push(value); }, configurable: true });
    if (i === 30) Object.defineProperty(Late, "late", { value: 0, writable: false, configurable: true });
    const result = attempt(() => store(make()));
    ownCount += result === true;
  }
  say("late", round, ownCount, seen.length);
}

// Refusals, deletions, many names, the class as a parent and in an instance.
for (let i = 0; i < 12; i++) {
  const made = plainFactory();
  [x => x, Object.preventExtensions, Object.seal, Object.freeze][i & 3](made);
  const result = attempt(() => { made.tag = i; });
  if (i > 7) say("closed", i & 3, result === undefined ? "stored" : result.split(":")[0], own(made));
}
for (let i = 0; i < 6; i++) {
  const made = namedFactory();
  made.a = 1;
  made.b = 2;
  if (i & 1) delete made.a;
  made.c = 3;
  made.a = 4;
  if (i > 3) say("deleted", own(made), made.a);
}
for (let i = 0; i < 4; i++) {
  const made = emptyMixin(Root);
  for (let k = 0; k < 60; k++) made["n" + k] = k;
  if (i === 3) say("many", Reflect.ownKeys(made).length, made.n0, made.n59);
}
for (let i = 0; i < 20; i++) {
  const Parent = plainFactory();
  Parent.tag = i;
  class Child extends Parent { static own = "own"; }
  Parent.later = "later" + i;
  Child.tag2 = Child.tag + 1;
  const grown = mixin(emptyMixin(Child.prototype.m ? Child : Root));
  grown.level = i;
  if (i > 17) say("parent", Child.tag, Child.later, Child.tag2, Child.own, own(Child), grown.inherited, new grown().m(), own(grown));
}
const kept = [];
for (let i = 0; i < 300; i++) {
  const made = i % 3 ? emptyMixin(Root) : plainFactory();
  made.label = { deep: "deep" + i };
  made.second = "second" + i;
  made.third = [i];
  made.fourth = i;
  made.fifth = -i;
  if (i % 30 === 0) kept.push(made);
  if (i % 60 === 0) Bun.gc(true);
}
Bun.gc(true);
say("kept", kept.map(made => [made.label.deep, made.second, made.third[0], made.fourth, made.fifth, new made() instanceof made]));

// Written in a loop, with the store right behind the class.
function inLoop(count) {
  let sum = 0;
  for (let i = 0; i < count; i++) {
    const made = class { };
    made.tag = i;
    made.next = made.tag + 1;
    sum += made.tag + made.next;
  }
  return sum;
}
function inLoopWithBase(count) {
  let sum = 0;
  for (let i = 0; i < count; i++) {
    const made = class extends Root { };
    made.tag = i;
    made.guarded = i;
    made.inherited = i;
    sum += made.tag + made.stored + made.inherited;
  }
  return [sum, Root.inherited, Object.hasOwn(Root, "stored")];
}
say("inLoop", inLoop(1), inLoop(2), inLoop(200), inLoopWithBase(1), inLoopWithBase(2), inLoopWithBase(200));

// A class that is evaluated once, then again.
function seldom() { return class { static count = 0; m() {} }; }
const first = seldom();
first.added = "first";
const second = seldom();
second.added = "second";
first.more = 1;
second.more = 2;
say("seldom", own(first), own(second), first.added, second.added, first.more, second.more);

// Schemas in the style of class factories.
function Schema(fields) {
  const made = class {
    static fields = fields;
    constructor(value) { this.value = value; }
    static make(value) { return new this(value); }
  };
  made.ast = { fields };
  made.annotations = [];
  made.pipe = function (...steps) { return steps.reduce((value, step) => step(value), this); };
  return made;
}
let schemas = "";
for (let i = 0; i < 40; i++) {
  class Person extends Schema({ i }) { static label = "person"; }
  Person.extra = i;
  schemas = [Person.fields, Person.ast, Person.make(i).value, own(Person), own(Object.getPrototypeOf(Person)), Person.pipe(made => made.label)];
}
say("schemas", schemas);
