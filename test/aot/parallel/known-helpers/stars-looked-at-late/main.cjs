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
// Each look stands in a function that is handed its own barrel alone: a name that one look stores is a name of that barrel, not of all thirty.
const firstLooks = [
  () => (b => [b, () => b.one])(require("./first-look/barrel-01.js")),
  () => (b => [b, () => b.missing])(require("./first-look/barrel-02.js")),
  () => (b => [b, () => "two" in b])(require("./first-look/barrel-03.js")),
  () => (b => [b, () => Object.prototype.hasOwnProperty.call(b, "three")])(require("./first-look/barrel-04.js")),
  () => (b => [b, () => Object.keys(b).join()])(require("./first-look/barrel-05.js")),
  () => (b => [b, () => listWithForIn(b)])(require("./first-look/barrel-06.js")),
  () => (b => [b, () => valuesOf({ ...b })])(require("./first-look/barrel-07.js")),
  () => (b => [b, () => JSON.stringify(b)])(require("./first-look/barrel-08.js")),
  () => (b => [b, () => valuesOf(Object.assign({}, b))])(require("./first-look/barrel-09.js")),
  () => (b => [b, () => valuesOf(Object.assign(b, { extra: "extra" }))])(require("./first-look/barrel-10.js")),
  () => (b => [b, () => Reflect.ownKeys(b).map(String).join()])(require("./first-look/barrel-11.js")),
  () => (b => [b, () => Object.keys(Object.getOwnPropertyDescriptor(b, "one")).join()])(require("./first-look/barrel-12.js")),
  () => (b => [b, () => [b[0], b["0"], 0 in b, b[-1], b[1.5]].join()])(require("./first-look/barrel-13.js")),
  () => (b => [b, () => ((b[0] = "zero"), Reflect.ownKeys(b).map(String).join())])(require("./first-look/barrel-14.js")),
  () => (b => [b, () => (b.one = "stored")])(require("./first-look/barrel-15.js")),
  () => (b => [b, () => delete b.one])(require("./first-look/barrel-16.js")),
  () => (b => [b, () => Object.defineProperty(b, "one", { value: "defined" })])(require("./first-look/barrel-17.js")),
  () => (b => [b, () => [Object.freeze(b) === b, Object.isFrozen(b), Object.isSealed(b), Object.isExtensible(b)].join()])(require("./first-look/barrel-18.js")),
  () => (b => [b, () => [Object.seal(b) === b, Object.isFrozen(b), Object.isSealed(b), Object.isExtensible(b)].join()])(require("./first-look/barrel-19.js")),
  () => (b => [b, () => [Object.preventExtensions(b) === b, Object.isFrozen(b), Object.isSealed(b), attempt(() => (b.more = 1))].join()])(require("./first-look/barrel-20.js")),
  () => (b => [b, () => [Object.create(b).two, "two" in Object.create(b), listWithForIn(Object.create(b))].join(" ")])(require("./first-look/barrel-21.js")),
  () => (b => [b, () => (Object.setPrototypeOf(b, { inherited: "inherited" }), [b.inherited, b.one, listWithForIn(b)].join(" "))])(require("./first-look/barrel-22.js")),
  () => (b => [b, () => [b.__esModule, (b.added = "added"), Object.keys(b).join()].join(" ")])(require("./first-look/barrel-23.js")),
  () => (b => [b, () => [Object.entries(b).join("|"), Object.values(b).join("|")].join(" ")])(require("./first-look/barrel-24.js")),
  () => (b => [b, () => [Object.isFrozen(b), Object.isSealed(b), Object.isExtensible(b)].join()])(require("./first-look/barrel-25.js")),
  () => (b => [b, () => [b.hasOwnProperty("one"), b.propertyIsEnumerable("one"), b.toString()].join()])(require("./first-look/barrel-26.js")),
  () => (b => [b, () => [typeof b.__lookupGetter__("one"), b.__lookupSetter__("one"), b.__lookupGetter__("__esModule")].join()])(require("./first-look/barrel-27.js")),
  () => (b => [b, () => (({ one, ...rest }) => [one, valuesOf(rest)].join(" "))(b)])(require("./first-look/barrel-28.js")),
  () => (b => [b, () => Object.defineProperty(b, "fresh", { value: "fresh", enumerable: true }) === b])(require("./first-look/barrel-29.js")),
  () => (b => [b, () => [Reflect.get(b, "two"), Reflect.has(b, "default"), Reflect.set(b, "two", 2), Reflect.deleteProperty(b, "two")].join()])(require("./first-look/barrel-30.js")),
];
firstLooks.forEach((load, index) => {
  const [barrel, look] = load();
  console.log(index + 1, attempt(look));
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
/* Output:
--- who looks first
1 "one"
1 __esModule{value=true writable=false enumerable=false configurable=false} one{get=function() { return m[k]; } set=undefined enumerable=true configurable=false} two{get=function() { return m[k]; } set=undefined enumerable=true configurable=false} three{get=function() { return m[k]; } set=undefined enumerable=true configurable=false}
1 one="one" two="two" three="three"
2 undefined
2 __esModule{value=true writable=false enumerable=false configurable=false} one{get=function() { return m[k]; } set=undefined enumerable=true configurable=false} two{get=function() { return m[k]; } set=undefined enumerable=true configurable=false} three{get=function() { return m[k]; } set=undefined enumerable=true configurable=false}
2 one="one" two="two" three="three"
3 true
3 __esModule{value=true writable=false enumerable=false configurable=false} one{get=function() { return m[k]; } set=undefined enumerable=true configurable=false} two{get=function() { return m[k]; } set=undefined enumerable=true configurable=false} three{get=function() { return m[k]; } set=undefined enumerable=true configurable=false}
3 one="one" two="two" three="three"
4 true
4 __esModule{value=true writable=false enumerable=false configurable=false} one{get=function() { return m[k]; } set=undefined enumerable=true configurable=false} two{get=function() { return m[k]; } set=undefined enumerable=true configurable=false} three{get=function() { return m[k]; } set=undefined enumerable=true configurable=false}
4 one="one" two="two" three="three"
5 "one,two,three"
5 __esModule{value=true writable=false enumerable=false configurable=false} one{get=function() { return m[k]; } set=undefined enumerable=true configurable=false} two{get=function() { return m[k]; } set=undefined enumerable=true configurable=false} three{get=function() { return m[k]; } set=undefined enumerable=true configurable=false}
5 one="one" two="two" three="three"
6 "one,two,three"
6 __esModule{value=true writable=false enumerable=false configurable=false} one{get=function() { return m[k]; } set=undefined enumerable=true configurable=false} two{get=function() { return m[k]; } set=undefined enumerable=true configurable=false} three{get=function() { return m[k]; } set=undefined enumerable=true configurable=false}
6 one="one" two="two" three="three"
7 "one=\"one\" two=\"two\" three=\"three\""
7 __esModule{value=true writable=false enumerable=false configurable=false} one{get=function() { return m[k]; } set=undefined enumerable=true configurable=false} two{get=function() { return m[k]; } set=undefined enumerable=true configurable=false} three{get=function() { return m[k]; } set=undefined enumerable=true configurable=false}
7 one="one" two="two" three="three"
8 "{\"one\":\"one\",\"two\":\"two\",\"three\":\"three\"}"
8 __esModule{value=true writable=false enumerable=false configurable=false} one{get=function() { return m[k]; } set=undefined enumerable=true configurable=false} two{get=function() { return m[k]; } set=undefined enumerable=true configurable=false} three{get=function() { return m[k]; } set=undefined enumerable=true configurable=false}
8 one="one" two="two" three="three"
9 "one=\"one\" two=\"two\" three=\"three\""
9 __esModule{value=true writable=false enumerable=false configurable=false} one{get=function() { return m[k]; } set=undefined enumerable=true configurable=false} two{get=function() { return m[k]; } set=undefined enumerable=true configurable=false} three{get=function() { return m[k]; } set=undefined enumerable=true configurable=false}
9 one="one" two="two" three="three"
10 "one=\"one\" two=\"two\" three=\"three\" extra=\"extra\""
10 __esModule{value=true writable=false enumerable=false configurable=false} one{get=function() { return m[k]; } set=undefined enumerable=true configurable=false} two{get=function() { return m[k]; } set=undefined enumerable=true configurable=false} three{get=function() { return m[k]; } set=undefined enumerable=true configurable=false} extra{value="extra" writable=true enumerable=true configurable=true}
10 one="one" two="two" three="three" extra="extra"
11 "__esModule,one,two,three"
11 __esModule{value=true writable=false enumerable=false configurable=false} one{get=function() { return m[k]; } set=undefined enumerable=true configurable=false} two{get=function() { return m[k]; } set=undefined enumerable=true configurable=false} three{get=function() { return m[k]; } set=undefined enumerable=true configurable=false}
11 one="one" two="two" three="three"
12 "get,set,enumerable,configurable"
12 __esModule{value=true writable=false enumerable=false configurable=false} one{get=function() { return m[k]; } set=undefined enumerable=true configurable=false} two{get=function() { return m[k]; } set=undefined enumerable=true configurable=false} three{get=function() { return m[k]; } set=undefined enumerable=true configurable=false}
12 one="one" two="two" three="three"
13 ",,false,,"
13 __esModule{value=true writable=false enumerable=false configurable=false} one{get=function() { return m[k]; } set=undefined enumerable=true configurable=false} two{get=function() { return m[k]; } set=undefined enumerable=true configurable=false} three{get=function() { return m[k]; } set=undefined enumerable=true configurable=false}
13 one="one" two="two" three="three"
14 "0,__esModule,one,two,three"
14 0{value="zero" writable=true enumerable=true configurable=true} __esModule{value=true writable=false enumerable=false configurable=false} one{get=function() { return m[k]; } set=undefined enumerable=true configurable=false} two{get=function() { return m[k]; } set=undefined enumerable=true configurable=false} three{get=function() { return m[k]; } set=undefined enumerable=true configurable=false}
14 0="zero" one="one" two="two" three="three"
15 threw TypeError: Attempted to assign to readonly property.
15 __esModule{value=true writable=false enumerable=false configurable=false} one{get=function() { return m[k]; } set=undefined enumerable=true configurable=false} two{get=function() { return m[k]; } set=undefined enumerable=true configurable=false} three{get=function() { return m[k]; } set=undefined enumerable=true configurable=false}
15 one="one" two="two" three="three"
16 threw TypeError: Unable to delete property.
16 __esModule{value=true writable=false enumerable=false configurable=false} one{get=function() { return m[k]; } set=undefined enumerable=true configurable=false} two{get=function() { return m[k]; } set=undefined enumerable=true configurable=false} three{get=function() { return m[k]; } set=undefined enumerable=true configurable=false}
16 one="one" two="two" three="three"
17 threw TypeError: Attempting to change access mechanism for an unconfigurable property.
17 __esModule{value=true writable=false enumerable=false configurable=false} one{get=function() { return m[k]; } set=undefined enumerable=true configurable=false} two{get=function() { return m[k]; } set=undefined enumerable=true configurable=false} three{get=function() { return m[k]; } set=undefined enumerable=true configurable=false}
17 one="one" two="two" three="three"
18 "true,true,true,false"
18 __esModule{value=true writable=false enumerable=false configurable=false} one{get=function() { return m[k]; } set=undefined enumerable=true configurable=false} two{get=function() { return m[k]; } set=undefined enumerable=true configurable=false} three{get=function() { return m[k]; } set=undefined enumerable=true configurable=false}
18 one="one" two="two" three="three"
19 "true,true,true,false"
19 __esModule{value=true writable=false enumerable=false configurable=false} one{get=function() { return m[k]; } set=undefined enumerable=true configurable=false} two{get=function() { return m[k]; } set=undefined enumerable=true configurable=false} three{get=function() { return m[k]; } set=undefined enumerable=true configurable=false}
19 one="one" two="two" three="three"
20 "true,true,true,threw TypeError: Attempting to define property on object that is not extensible."
20 __esModule{value=true writable=false enumerable=false configurable=false} one{get=function() { return m[k]; } set=undefined enumerable=true configurable=false} two{get=function() { return m[k]; } set=undefined enumerable=true configurable=false} three{get=function() { return m[k]; } set=undefined enumerable=true configurable=false}
20 one="one" two="two" three="three"
21 "two true one,two,three"
21 __esModule{value=true writable=false enumerable=false configurable=false} one{get=function() { return m[k]; } set=undefined enumerable=true configurable=false} two{get=function() { return m[k]; } set=undefined enumerable=true configurable=false} three{get=function() { return m[k]; } set=undefined enumerable=true configurable=false}
21 one="one" two="two" three="three"
22 "inherited one one,two,three,inherited"
22 __esModule{value=true writable=false enumerable=false configurable=false} one{get=function() { return m[k]; } set=undefined enumerable=true configurable=false} two{get=function() { return m[k]; } set=undefined enumerable=true configurable=false} three{get=function() { return m[k]; } set=undefined enumerable=true configurable=false}
22 one="one" two="two" three="three"
23 "true added one,two,three,added"
23 __esModule{value=true writable=false enumerable=false configurable=false} one{get=function() { return m[k]; } set=undefined enumerable=true configurable=false} two{get=function() { return m[k]; } set=undefined enumerable=true configurable=false} three{get=function() { return m[k]; } set=undefined enumerable=true configurable=false} added{value="added" writable=true enumerable=true configurable=true}
23 one="one" two="two" three="three" added="added"
24 "one,one|two,two|three,three one|two|three"
24 __esModule{value=true writable=false enumerable=false configurable=false} one{get=function() { return m[k]; } set=undefined enumerable=true configurable=false} two{get=function() { return m[k]; } set=undefined enumerable=true configurable=false} three{get=function() { return m[k]; } set=undefined enumerable=true configurable=false}
24 one="one" two="two" three="three"
25 "false,false,true"
25 __esModule{value=true writable=false enumerable=false configurable=false} one{get=function() { return m[k]; } set=undefined enumerable=true configurable=false} two{get=function() { return m[k]; } set=undefined enumerable=true configurable=false} three{get=function() { return m[k]; } set=undefined enumerable=true configurable=false}
25 one="one" two="two" three="three"
26 "true,true,[object Object]"
26 __esModule{value=true writable=false enumerable=false configurable=false} one{get=function() { return m[k]; } set=undefined enumerable=true configurable=false} two{get=function() { return m[k]; } set=undefined enumerable=true configurable=false} three{get=function() { return m[k]; } set=undefined enumerable=true configurable=false}
26 one="one" two="two" three="three"
27 "function,,"
27 __esModule{value=true writable=false enumerable=false configurable=false} one{get=function() { return m[k]; } set=undefined enumerable=true configurable=false} two{get=function() { return m[k]; } set=undefined enumerable=true configurable=false} three{get=function() { return m[k]; } set=undefined enumerable=true configurable=false}
27 one="one" two="two" three="three"
28 "one two=\"two\" three=\"three\""
28 __esModule{value=true writable=false enumerable=false configurable=false} one{get=function() { return m[k]; } set=undefined enumerable=true configurable=false} two{get=function() { return m[k]; } set=undefined enumerable=true configurable=false} three{get=function() { return m[k]; } set=undefined enumerable=true configurable=false}
28 one="one" two="two" three="three"
29 true
29 __esModule{value=true writable=false enumerable=false configurable=false} one{get=function() { return m[k]; } set=undefined enumerable=true configurable=false} two{get=function() { return m[k]; } set=undefined enumerable=true configurable=false} three{get=function() { return m[k]; } set=undefined enumerable=true configurable=false} fresh{value="fresh" writable=false enumerable=true configurable=false}
29 one="one" two="two" three="three" fresh="fresh"
30 "two,false,false,false"
30 __esModule{value=true writable=false enumerable=false configurable=false} one{get=function() { return m[k]; } set=undefined enumerable=true configurable=false} two{get=function() { return m[k]; } set=undefined enumerable=true configurable=false} three{get=function() { return m[k]; } set=undefined enumerable=true configurable=false}
30 one="one" two="two" three="three"
--- the source changes between the star and the first look
__esModule{value=true writable=false enumerable=false configurable=false} one{get=function() { return m[k]; } set=undefined enumerable=true configurable=false} two{get=function() { return m[k]; } set=undefined enumerable=true configurable=false} three{get=function() { return m[k]; } set=undefined enumerable=true configurable=false}
one="one, changed" two=undefined three="three, hidden" false
one="one, changed" two="two, back" three="three, hidden" one,four,two
--- stars of stars, the outermost first
middle="middle" deep="deep" deeper="deeper" one="one" two="two" three="three"
__esModule{value=true writable=false enumerable=false configurable=false} middle{get=function() { return m[k]; } set=undefined enumerable=true configurable=false} deep{get=function() { return m[k]; } set=undefined enumerable=true configurable=false} deeper{get=function() { return m[k]; } set=undefined enumerable=true configurable=false} one{get=function() { return m[k]; } set=undefined enumerable=true configurable=false} two{get=function() { return m[k]; } set=undefined enumerable=true configurable=false} three{get=function() { return m[k]; } set=undefined enumerable=true configurable=false}
deep true true function undefined
deeper true true function undefined
middle true false undefined undefined
one true false undefined undefined
__esModule{value=true writable=false enumerable=false configurable=false} middle{get=function() { return m[k]; } set=undefined enumerable=true configurable=false} deep{get=function() { return m[k]; } set=undefined enumerable=true configurable=false} deeper{get=function() { return m[k]; } set=undefined enumerable=true configurable=false} one{get=function() { return m[k]; } set=undefined enumerable=true configurable=false} two{get=function() { return m[k]; } set=undefined enumerable=true configurable=false} three{get=function() { return m[k]; } set=undefined enumerable=true configurable=false}
__esModule{value=true writable=false enumerable=false configurable=false} middle{value="middle" writable=true enumerable=true configurable=true} deep{get=function() { return m[k]; } set=undefined enumerable=true configurable=false} deeper{get=function() { return m[k]; } set=undefined enumerable=true configurable=false}
middle="middle, changed" deep="deep, changed" deeper="deeper" one="one" two="two" three="three" middle="middle, changed" deep="deep, changed" deeper="deeper"
--- stars of stars, the innermost first
__esModule{value=true writable=false enumerable=false configurable=false} deep{get=function() { return m[k]; } set=undefined enumerable=true configurable=false} deeper{get=function() { return m[k]; } set=undefined enumerable=true configurable=false}
true true false
__esModule{value=true writable=false enumerable=false configurable=false} deep{get=function() { return m[k]; } set=undefined enumerable=true configurable=false} deeper{get=function() { return m[k]; } set=undefined enumerable=true configurable=false}
--- the module in the middle says that it is no ES module
false deep deep false true
__esModule{value=true writable=false enumerable=false configurable=false} deep{get=function() { return m[k]; } set=undefined enumerable=true configurable=false}
--- the module in the middle says nothing
false deep middle undefined
__esModule{value=true writable=false enumerable=false configurable=false} middle{get=function() { return m[k]; } set=undefined enumerable=true configurable=false} deep{get=function() { return m[k]; } set=undefined enumerable=true configurable=false}
middle{value="middle" writable=true enumerable=true configurable=true} deep{get=function() { return m[k]; } set=undefined enumerable=true configurable=false}
--- the helpers of TypeScript before 4.6
false deep deep
__esModule{value=true writable=false enumerable=false configurable=false} deep{get=function() { return m[k]; } set=undefined enumerable=true configurable=false}
--- names that the target has
__esModule{value=true writable=false enumerable=false configurable=false} two{value="my own two" writable=true enumerable=true configurable=true} last{value="last" writable=true enumerable=true configurable=true} one{get=function() { return m[k]; } set=undefined enumerable=true configurable=false} three{get=function() { return m[k]; } set=undefined enumerable=true configurable=false}
true false undefined
__esModule{value=true writable=false enumerable=false configurable=false} one{get=function() { return m[k]; } set=undefined enumerable=true configurable=false} three{get=function() { return m[k]; } set=undefined enumerable=true configurable=false}
__esModule{value=true writable=false enumerable=false configurable=false} one{get=function() { return m[k]; } set=undefined enumerable=true configurable=false} three{get=function() { return m[k]; } set=undefined enumerable=true configurable=false} two{value="two again" writable=true enumerable=true configurable=true}
__esModule{value=true writable=false enumerable=false configurable=false} one{get=function() { return m[k]; } set=undefined enumerable=true configurable=false} two{get=function() { return m[k]; } set=undefined enumerable=true configurable=false} three{get=function() { return m[k]; } set=undefined enumerable=true configurable=false} late{value="late" writable=true enumerable=true configurable=true} default{value="my default" writable=true enumerable=true configurable=true}
one="one" two="two" three="three" four="four" false
two="two" four="four" one="one" three="three"
one="one" two="two" three="three" four="four"
two="two of the other leaf" four="four" one="one" three="three"
__esModule{value=true writable=false enumerable=false configurable=false} one{get=function() { return m[k]; } set=undefined enumerable=true configurable=false} two{get=function() { return m[k]; } set=undefined enumerable=true configurable=false} three{get=function() { return m[k]; } set=undefined enumerable=true configurable=false}
--- frozen and sealed
__esModule{value=true writable=false enumerable=false configurable=false} one{get=function() { return m[k]; } set=undefined enumerable=true configurable=false} two{get=function() { return m[k]; } set=undefined enumerable=true configurable=false} true
__esModule{value=true writable=false enumerable=false configurable=false} one{value="one" writable=false enumerable=true configurable=false} two{value="two" writable=false enumerable=true configurable=false}
__esModule{value=true writable=false enumerable=false configurable=false} one{get=function() { return m[k]; } set=undefined enumerable=true configurable=false} two{get=function() { return m[k]; } set=undefined enumerable=true configurable=false}
the star threw TypeError Attempting to define property on object that is not extensible.
__esModule{value=true writable=false enumerable=false configurable=false}
--- modules that require each other
__esModule{value=true writable=false enumerable=false configurable=false} mine{value="mine of b" writable=true enumerable=true configurable=true} early{get=function() { return m[k]; } set=undefined enumerable=true configurable=false} two{get=function() { return m[k]; } set=undefined enumerable=true configurable=false} four{get=function() { return m[k]; } set=undefined enumerable=true configurable=false}
__esModule{value=true writable=false enumerable=false configurable=false} early{value="early of a" writable=true enumerable=true configurable=true} mine{get=function() { return m[k]; } set=undefined enumerable=true configurable=false} two{get=function() { return m[k]; } set=undefined enumerable=true configurable=false} four{get=function() { return m[k]; } set=undefined enumerable=true configurable=false} one{get=function() { return m[k]; } set=undefined enumerable=true configurable=false} three{get=function() { return m[k]; } set=undefined enumerable=true configurable=false}
early "early of a" "early of a" false
mine "mine of b" "mine of b" false
two "two of the other leaf" "two of the other leaf" true
four "four" "four" true
one "one" undefined false
--- sources with more than plain properties
true 1 2 3
__esModule{value=true writable=false enumerable=false configurable=false} plain{get=function() { return m[k]; } set=undefined enumerable=true configurable=false} counted{get=function () { return ++reads; } set=undefined enumerable=true configurable=false} fixed{value="fixed" writable=false enumerable=true configurable=false}
__esModule{value=true writable=false enumerable=false configurable=false} one{get=function() { return m[k]; } set=undefined enumerable=true configurable=false} computed{get=function() { return m[k]; } set=undefined enumerable=true configurable=false}
--- a collection between the star and the first look
20000 __esModule{value=true writable=false enumerable=false configurable=false} one{get=function() { return m[k]; } set=undefined enumerable=true configurable=false} two{get=function() { return m[k]; } set=undefined enumerable=true configurable=false}
one="one" two="two"
*/
