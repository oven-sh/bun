// `export * from` as TypeScript emits it for CommonJS, where nobody looks at the re-exporting module for a while: what the star defined is what plain Bun defines at the call, whatever happens in between and whoever looks first.
// The output is stored for the text of functions alone: the executable prints a function as its file spells it, plain Bun as its transpiler prints it again.
// STATISTIC: KnownHelperCalls >= 40
// COUNTER: StarsRecorded >= 40
// COUNTER: StarsCarriedOutLate >= 40
"use strict";
const show = value => (typeof value === "function" ? String(value) : typeof value === "string" ? JSON.stringify(value) : String(value));
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

section("who looks first");
const listWithForIn = object => {
  const listed = [];
  for (const key in object) listed.push(key);
  return listed.join();
};
const firstLooks = [
  [() => require("./first-look/barrel-01.js"), b => b.one],
  [() => require("./first-look/barrel-02.js"), b => b.missing],
  [() => require("./first-look/barrel-03.js"), b => "two" in b],
  [() => require("./first-look/barrel-04.js"), b => Object.prototype.hasOwnProperty.call(b, "three")],
  [() => require("./first-look/barrel-05.js"), b => Object.keys(b).join()],
  [() => require("./first-look/barrel-06.js"), b => listWithForIn(b)],
  [() => require("./first-look/barrel-07.js"), b => valuesOf({ ...b })],
  [() => require("./first-look/barrel-08.js"), b => JSON.stringify(b)],
  [() => require("./first-look/barrel-09.js"), b => valuesOf(Object.assign({}, b))],
  [() => require("./first-look/barrel-10.js"), b => valuesOf(Object.assign(b, { extra: "extra" }))],
  [() => require("./first-look/barrel-11.js"), b => Reflect.ownKeys(b).map(String).join()],
  [() => require("./first-look/barrel-12.js"), b => Object.keys(Object.getOwnPropertyDescriptor(b, "one")).join()],
  [() => require("./first-look/barrel-13.js"), b => [b[0], b["0"], 0 in b, b[-1], b[1.5]].join()],
  [() => require("./first-look/barrel-14.js"), b => ((b[0] = "zero"), Reflect.ownKeys(b).map(String).join())],
  [() => require("./first-look/barrel-15.js"), b => (b.one = "stored")],
  [() => require("./first-look/barrel-16.js"), b => delete b.one],
  [() => require("./first-look/barrel-17.js"), b => Object.defineProperty(b, "one", { value: "defined" })],
  [() => require("./first-look/barrel-18.js"), b => [Object.freeze(b) === b, Object.isFrozen(b), Object.isSealed(b), Object.isExtensible(b)].join()],
  [() => require("./first-look/barrel-19.js"), b => [Object.seal(b) === b, Object.isFrozen(b), Object.isSealed(b), Object.isExtensible(b)].join()],
  [() => require("./first-look/barrel-20.js"), b => [Object.preventExtensions(b) === b, Object.isFrozen(b), Object.isSealed(b), attempt(() => (b.more = 1))].join()],
  [() => require("./first-look/barrel-21.js"), b => [Object.create(b).two, "two" in Object.create(b), listWithForIn(Object.create(b))].join(" ")],
  [() => require("./first-look/barrel-22.js"), b => (Object.setPrototypeOf(b, { inherited: "inherited" }), [b.inherited, b.one, listWithForIn(b)].join(" "))],
  [() => require("./first-look/barrel-23.js"), b => [b.__esModule, (b.added = "added"), Object.keys(b).join()].join(" ")],
  [() => require("./first-look/barrel-24.js"), b => [Object.entries(b).join("|"), Object.values(b).join("|")].join(" ")],
  [() => require("./first-look/barrel-25.js"), b => [Object.isFrozen(b), Object.isSealed(b), Object.isExtensible(b)].join()],
  [() => require("./first-look/barrel-26.js"), b => [b.hasOwnProperty("one"), b.propertyIsEnumerable("one"), b.toString()].join()],
  [() => require("./first-look/barrel-27.js"), b => [typeof b.__lookupGetter__("one"), b.__lookupSetter__("one"), b.__lookupGetter__("__esModule")].join()],
  [() => require("./first-look/barrel-28.js"), b => (({ one, ...rest }) => [one, valuesOf(rest)].join(" "))(b)],
  [() => require("./first-look/barrel-29.js"), b => Object.defineProperty(b, "fresh", { value: "fresh", enumerable: true }) === b],
  [() => require("./first-look/barrel-30.js"), b => [Reflect.get(b, "two"), Reflect.has(b, "default"), Reflect.set(b, "two", 2), Reflect.deleteProperty(b, "two")].join()],
];
firstLooks.forEach(([load, look], index) => {
  const barrel = load();
  console.log(index + 1, attempt(() => look(barrel)));
  console.log(index + 1, describe(barrel));
  console.log(index + 1, valuesOf(barrel));
});

section("the source changes between the star and the first look");
{
  const barrel = require("./changed/barrel.js");
  const leaf = require("./changed/leaf.js");
  delete leaf.two;
  leaf.four = "four";
  leaf.one = "one, changed";
  Object.defineProperty(leaf, "three", { enumerable: false, value: "three, hidden" });
  console.log(describe(barrel));
  console.log(valuesOf(barrel), "four" in barrel);
  leaf.two = "two, back";
  console.log(valuesOf(barrel), Object.keys(leaf).join());
}

section("stars of stars, the outermost first");
{
  const outermost = require("./nested/outermost.js");
  const outer = require("./nested/outer.js");
  const middle = require("./nested/middle.js");
  const leaf = require("./nested/leaf.js");
  console.log(valuesOf(outermost));
  console.log(describe(outermost));
  for (const key of ["deep", "deeper", "middle", "one"])
    console.log(key, getterOf(outermost, key) === getterOf(outer, key), getterOf(outer, key) === getterOf(middle, key), typeof getterOf(middle, key), typeof getterOf(leaf, key));
  console.log(describe(outer));
  console.log(describe(middle));
  leaf.deep = "deep, changed";
  middle.middle = "middle, changed";
  console.log(valuesOf(outermost), valuesOf(middle));
}

section("stars of stars, the innermost first");
{
  const outer = require("./nested-inner-first/outer.js");
  const middle = require("./nested-inner-first/middle.js");
  const getter = getterOf(middle, "deep");
  console.log(describe(middle));
  console.log(getterOf(outer, "deep") === getter, getterOf(outer, "deeper") === getterOf(middle, "deeper"), getterOf(outer, "deep") === getterOf(outer, "deeper"));
  console.log(describe(outer));
}

section("the module in the middle says that it is no ES module");
{
  const outer = require("./nested-marked-false/outer.js");
  const middle = require("./nested-marked-false/middle.js");
  console.log(getterOf(outer, "deep") === getterOf(middle, "deep"), outer.deep, middle.deep, middle.__esModule, outer.__esModule);
  console.log(describe(outer));
}

section("the module in the middle says nothing");
{
  const outer = require("./nested-unmarked/outer.js");
  const middle = require("./nested-unmarked/middle.js");
  console.log(getterOf(outer, "deep") === getterOf(middle, "deep"), outer.deep, outer.middle, middle.__esModule);
  console.log(describe(outer));
  console.log(describe(middle));
}

section("the helpers of TypeScript before 4.6");
{
  const outer = require("./nested-old-helpers/outer.js");
  const middle = require("./nested-old-helpers/middle.js");
  console.log(getterOf(outer, "deep") === getterOf(middle, "deep"), outer.deep, middle.deep);
  console.log(describe(outer));
}

section("names that the target has");
console.log(describe(require("./own-names/barrel.js")));
{
  const barrel = require("./own-name-deleted/barrel.js");
  console.log(delete barrel.two, "two" in barrel, barrel.two);
  console.log(describe(barrel));
  barrel.two = "two again";
  console.log(describe(barrel));
}
console.log(describe(require("./name-stored-late/barrel.js")));
console.log(valuesOf(require("./overlap/barrel.js")), getterOf(require("./overlap/barrel.js"), "two") === getterOf(require("./overlap-reversed/barrel.js"), "two"));
console.log(valuesOf(require("./overlap-reversed/barrel.js")));
require("./other-leaf.js").two = "two of the other leaf";
console.log(valuesOf(require("./overlap/barrel.js")));
console.log(valuesOf(require("./overlap-reversed/barrel.js")));
console.log(describe(require("./same-source-twice/barrel.js")));

section("frozen and sealed");
{
  const barrel = require("./frozen-late/barrel.js");
  const leaf = Object.freeze(require("./frozen-late/leaf.js"));
  console.log(describe(barrel), Object.isFrozen(leaf));
}
console.log(describe(require("./frozen-early/barrel.js")));
console.log(describe(require("./sealed-early/barrel.js")));
console.log(describe(require("./target-not-extensible/barrel.js")));

section("modules that require each other");
{
  const a = require("./cycle/a.js");
  const b = require("./cycle/b.js");
  console.log(describe(b));
  console.log(describe(a));
  for (const key of ["early", "mine", "two", "four", "one"])
    console.log(key, show(a[key]), show(b[key]), getterOf(a, key) === getterOf(b, key));
}

section("sources with more than plain properties");
{
  const barrel = require("./source-with-accessor/barrel.js");
  const leaf = require("./source-with-accessor/leaf.js");
  console.log(getterOf(barrel, "counted") === getterOf(leaf, "counted"), barrel.counted, leaf.counted, barrel.counted);
  console.log(describe(barrel));
}
console.log(describe(require("./source-gets-names-by-name/barrel.js")));

section("a collection between the star and the first look");
{
  const barrel = require("./collected/barrel.js");
  if (typeof Bun === "object") Bun.gc(true);
  const garbage = [];
  for (let i = 0; i < 20000; i++) garbage.push({ i, text: "garbage " + i });
  if (typeof Bun === "object") Bun.gc(true);
  console.log(garbage.length, describe(barrel));
  console.log(valuesOf(barrel));
}
