// Each unused declaration looks like a plain value and hides something that runs when it is evaluated: a computed key that is an object, a class's computed key, a spread, a template with an object, a getter behind a pattern, a default in a pattern, a tag, `in`, instanceof, a comparison and a sum that convert an object, a class that extends a call, `new` without a mark, an optional call, a comma. `bun run` runs all of it. `bun build --compile` takes a name as the computed key of a class member for harmless, so the two classes go and the key's toString runs once, for the object literal; everything else runs.
const log = [];
const effect = name => { log.push(name); return name; };
const keyObject = { toString() { return effect("toString of a key"); } };
const converts = { valueOf() { effect("valueOf"); return 1; }, [Symbol.toPrimitive]: undefined };
const primitive = { [Symbol.toPrimitive]() { return effect("Symbol.toPrimitive"); } };
const withGetter = { get value() { return effect("a getter"); } };
const iterable = { *[Symbol.iterator]() { effect("an iterator"); } };
class HasInstance { static [Symbol.hasInstance]() { effect("Symbol.hasInstance"); return true; } }
const trap = new Proxy({}, { has() { effect("a has trap"); return true; }, get() { return effect("a get trap"); } });

const a1 = { [keyObject]: 1 };
class A2 { [keyObject]() {} }
class A3 { static [keyObject] = 1; }
const a4 = { ...withGetter };
const a5 = [...iterable];
const a6 = `${primitive}`;
const a7 = "" + primitive;
const { value: a8 } = withGetter;
const [a9] = iterable;
const { a10 = effect("a default in a pattern") } = {};
const a11 = effect`a tag`;
const a12 = "key" in trap;
const a13 = {} instanceof HasInstance;
const a14 = converts == 1;
const a15 = converts < 2;
const a16 = converts + 1;
const a17 = -converts;
const a18 = ~converts;
class A19 extends (effect("extends"), Object) {}
const a20 = new (class { constructor() { effect("a constructor"); } })();
const a21 = effect?.("an optional call");
const a22 = (effect("the left of a comma"), 1);
const a23 = trap.anything;
const a24 = trap["any" + "thing"];
const a25 = withGetter?.value;
const a26 = [effect("an element")];
const a27 = { key: effect("a property value") };
const a28 = true && effect("the right of &&");
const a29 = null ?? effect("the right of ??");
const a30 = log.length ? effect("an arm") : 0;
const a31 = typeof effect("the operand of typeof");
const a32 = void effect("the operand of void");
const a33 = !effect("the operand of !");
const a34 = delete trap.gone;
let a35 = 0;
const a36 = a35++;

console.log(log.join("\n"));
