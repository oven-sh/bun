// `export * from` as TypeScript emits it for CommonJS, into modules whose exports somebody also stores names to: the star still waits until somebody looks, and it binds what plain Bun binds at the call, also under a name that is stored later.
// STATISTIC: KnownHelperCalls >= 40
// COUNTER: StarsRecorded >= 55
// COUNTER: StarsCarriedOutLate >= 40
"use strict";
const show = value => (typeof value === "function" ? "function" : typeof value === "string" ? JSON.stringify(value) : String(value));
const describe = object =>
  Reflect.ownKeys(object)
    .map(key => {
      const d = Object.getOwnPropertyDescriptor(object, key);
      return `${String(key)}{${Object.keys(d).map(name => `${name}=${show(d[name])}`).join(" ")}}`;
    })
    .join(" ");
const valuesOf = object => Object.keys(object).map(key => `${key}=${show(object[key])}`).join(" ");
const getterOf = (object, key) => Object.getOwnPropertyDescriptor(object, key)?.get;
const attempt = work => {
  try {
    return show(work());
  } catch (error) {
    return `threw ${error.constructor.name}: ${error.message}`;
  }
};
const section = name => console.log(`--- ${name}`);
const listWithForIn = object => {
  const listed = [];
  for (const key in object) listed.push(key);
  return listed.join();
};

section("who looks first");
// Every look is handed every barrel as far as the compiler can tell, so a name that one look stores is a name that each of the thirty may get: `one`, which the star binds, and `more`, `added` and `two`.
const firstLooks = [
  [require("./first-look/barrel-01.js"), b => b.one],
  [require("./first-look/barrel-02.js"), b => b.missing],
  [require("./first-look/barrel-03.js"), b => "two" in b],
  [require("./first-look/barrel-04.js"), b => Object.prototype.hasOwnProperty.call(b, "three")],
  [require("./first-look/barrel-05.js"), b => Object.keys(b).join()],
  [require("./first-look/barrel-06.js"), b => listWithForIn(b)],
  [require("./first-look/barrel-07.js"), b => valuesOf({ ...b })],
  [require("./first-look/barrel-08.js"), b => JSON.stringify(b)],
  [require("./first-look/barrel-09.js"), b => valuesOf(Object.assign({}, b))],
  [require("./first-look/barrel-10.js"), b => valuesOf(Object.assign(b, { extra: "extra" }))],
  [require("./first-look/barrel-11.js"), b => Reflect.ownKeys(b).map(String).join()],
  [require("./first-look/barrel-12.js"), b => Object.keys(Object.getOwnPropertyDescriptor(b, "one")).join()],
  [require("./first-look/barrel-13.js"), b => [b.more, b.added, "more" in b, Object.hasOwn(b, "added")].join()],
  [require("./first-look/barrel-14.js"), b => ((b[0] = "zero"), Reflect.ownKeys(b).map(String).join())],
  [require("./first-look/barrel-15.js"), b => (b.one = "stored")],
  [require("./first-look/barrel-16.js"), b => delete b.one],
  [require("./first-look/barrel-17.js"), b => Object.defineProperty(b, "one", { value: "defined" })],
  [require("./first-look/barrel-18.js"), b => [Object.freeze(b) === b, Object.isFrozen(b), Object.isSealed(b), Object.isExtensible(b)].join()],
  [require("./first-look/barrel-19.js"), b => [Object.seal(b) === b, Object.isFrozen(b), Object.isSealed(b), Object.isExtensible(b)].join()],
  [require("./first-look/barrel-20.js"), b => [Object.preventExtensions(b) === b, Object.isFrozen(b), Object.isSealed(b), attempt(() => (b.more = 1))].join()],
  [require("./first-look/barrel-21.js"), b => [Object.create(b).two, "two" in Object.create(b), listWithForIn(Object.create(b))].join(" ")],
  [require("./first-look/barrel-22.js"), b => (Object.setPrototypeOf(b, { inherited: "inherited", more: "more, inherited" }), [b.inherited, b.one, b.more, listWithForIn(b)].join(" "))],
  [require("./first-look/barrel-23.js"), b => [b.__esModule, (b.added = "added"), Object.keys(b).join()].join(" ")],
  [require("./first-look/barrel-24.js"), b => [(b.more = "more"), b.more, b.one, (b.added = "added"), Object.keys(b).join()].join(" ")],
  [require("./first-look/barrel-25.js"), b => [delete b.more, delete b.added, b.more, Object.keys(b).join()].join(" ")],
  [require("./first-look/barrel-26.js"), b => [b.hasOwnProperty("one"), b.propertyIsEnumerable("one"), b.hasOwnProperty("more"), b.toString()].join()],
  [require("./first-look/barrel-27.js"), b => [typeof b.__lookupGetter__("one"), b.__lookupSetter__("one"), b.__lookupGetter__("more")].join()],
  [require("./first-look/barrel-28.js"), b => (({ one, more, ...rest }) => [one, more, valuesOf(rest)].join(" "))(b)],
  [require("./first-look/barrel-29.js"), b => Object.defineProperty(b, "more", { value: "more", enumerable: true }) === b],
  [require("./first-look/barrel-30.js"), b => [Reflect.get(b, "two"), Reflect.has(b, "default"), Reflect.set(b, "two", 2), attempt(() => (b.two = 2)), Reflect.deleteProperty(b, "two")].join()],
];
firstLooks.forEach(([barrel, look], index) => {
  console.log(index + 1, attempt(() => look(barrel)));
  console.log(index + 1, describe(barrel));
  console.log(index + 1, valuesOf(barrel));
});

section("barrels that are only read and stored to");
{
  const barrels = [
    require("./only-read/barrel-1.js"),
    require("./only-read/barrel-2.js"),
    require("./only-read/barrel-3.js"),
    require("./only-read/barrel-4.js"),
    require("./only-read/barrel-5.js"),
    require("./only-read/barrel-6.js"),
  ];
  const tag = (barrel, index) => {
    if (index % 2) barrel.tag = "tag " + index;
    if (index === 4) barrel.five = "stored";
  };
  barrels.forEach((barrel, index) => console.log(index, barrel.tag, attempt(() => tag(barrel, index)), barrel.tag, barrel.one, barrel.two, barrel.five, barrel.default));
  require("./leaf.js").one = "one, changed";
  barrels.forEach((barrel, index) => console.log(index, barrel.one, barrel.tag, "tag" in barrel, valuesOf(barrel)));
  require("./leaf.js").one = "one of leaf";
}

section("names that the module stores behind its star");
console.log(describe(require("./stored-behind-the-star/barrel.js")));
console.log(describe(require("./bound-name-stored-behind-the-star/barrel.js")));
console.log(describe(require("./bound-name-stored-in-sloppy-code/barrel.js")));

section("two stars have a name that is stored later");
for (const barrel of [require("./both-stars-have-the-name/barrel.js"), require("./both-stars-have-the-name/reversed.js")]) {
  console.log(barrel.two, attempt(() => (barrel.two = "stored")), barrel.two);
  console.log(describe(barrel));
  console.log(valuesOf(barrel));
}

section("a name that comes or goes between two stars");
console.log(describe(require("./stored-between-two-stars/barrel.js")));
console.log(valuesOf(require("./stored-between-two-stars/barrel.js")));
console.log(describe(require("./deleted-between-two-stars/barrel.js")));
console.log(valuesOf(require("./deleted-between-two-stars/barrel.js")));

section("stars of stars");
const storeOne = barrel => attempt(() => (barrel.one = "stored"));
{
  const outer = require("./nested/outer.js");
  const middle = require("./nested/middle.js");
  console.log(outer.one, outer.middle, outer.two, middle.one);
  console.log(describe(outer));
  console.log(storeOne(outer), storeOne(middle), getterOf(outer, "one") === getterOf(middle, "one"), getterOf(outer, "two") === getterOf(middle, "two"));
  console.log(describe(middle));
  console.log(valuesOf(outer), valuesOf(middle));
}
{
  const outer = require("./nested-inner-first/outer.js");
  const middle = require("./nested-inner-first/middle.js");
  console.log(storeOne(middle), describe(middle));
  console.log(storeOne(outer), getterOf(outer, "one") === getterOf(middle, "one"), getterOf(outer, "two") === getterOf(middle, "two"));
  console.log(describe(outer));
}

section("a collection between the star and the first look");
{
  const barrel = require("./collected/barrel.js");
  if (typeof Bun === "object") Bun.gc(true);
  const garbage = [];
  for (let i = 0; i < 20000; i++) garbage.push({ i, text: "garbage " + i });
  if (typeof Bun === "object") Bun.gc(true);
  console.log(garbage.length, storeOne(barrel), describe(barrel));
  console.log(valuesOf(barrel));
}
