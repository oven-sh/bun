function check(actual, expected, what) {
    if (!Object.is(actual, expected))
        throw new Error(what + ": " + String(actual) + " instead of " + String(expected));
}
function describe(object) {
    return Reflect.ownKeys(object).map(key => {
        const descriptor = Object.getOwnPropertyDescriptor(object, key);
        return String(key) + "=" + String(descriptor.value) + (descriptor.writable && descriptor.enumerable && descriptor.configurable ? "" : "!");
    }).join(",");
}
function repeat(f) {
    for (let i = 0; i < 100; i++)
        f(i);
}

function spreadLast(o, i) { return { z: i, ...o }; }
function spreadTwo(o, p) { return { ...o, ...p }; }
function spreadBetween(o, i) { return { x: i, ...o, y: i }; }
function spreadOver(o) { return { b: "mine", a: "mine", ...o }; }
function restOf(o) { const { a, ...rest } = o; return rest; }
function restOfTwo(o) { const { a, c, ...rest } = o; return rest; }
function restWithComputedName(o, name) { const { [name]: taken, ...rest } = o; return rest; }
function spreadFirstOnly(o) { return { ...o }; }
function noSpread(o) { return { a: o.a }; }
for (const f of [spreadLast, spreadTwo, spreadBetween, spreadOver, restOf, restOfTwo, restWithComputedName, spreadFirstOnly, noSpread])
    noInline(f);

repeat(i => {
    check(describe(spreadLast({ a: 1, b: 2 }, i)), "z=" + i + ",a=1,b=2", "a spread after a property");
    check(describe(spreadTwo({ a: 1, b: 2 }, { c: 3, a: i })), "a=" + i + ",b=2,c=3", "two spreads");
    check(describe(spreadBetween({ a: 1, y: 2, x: 3 }, i)), "x=3,a=1,y=" + i, "a spread between properties");
    check(describe(spreadOver({ a: 1, b: 2, c: 3 })), "b=2,a=1,c=3", "a spread over properties that are there");
    check(describe(restOf({ a: 1, b: 2, c: i })), "b=2,c=" + i, "the rest");
    check(describe(restOf({ b: 2, c: i })), "b=2,c=" + i, "the rest where nothing is taken");
    check(describe(restOf({ a: 1 })), "", "the rest where everything is taken");
    check(describe(restOfTwo({ d: 4, c: 3, b: 2, a: 1 })), "d=4,b=2", "the rest of two");
    check(describe(restWithComputedName({ a: 1, b: 2, c: 3 }, "b")), "a=1,c=3", "the rest with a computed name");
});

repeat(i => {
    check(describe(spreadLast(null, i)), "z=" + i, "null");
    check(describe(spreadLast(undefined, i)), "z=" + i, "undefined");
    check(describe(spreadLast(5, i)), "z=" + i, "a number");
    check(describe(spreadLast("ab", i)), "0=a,1=b,z=" + i, "a string");
    check(describe(spreadLast([7, 8], i)), "0=7,1=8,z=" + i, "an array");
    check(describe(spreadLast({ 1: "one", a: 1 }, i)), "1=one,z=" + i + ",a=1", "an object with an index");
});

{
    const symbol = Symbol("s");
    const hidden = Object.defineProperty({ a: 1, c: 3 }, "b", { value: 2, enumerable: false });
    const readOnly = Object.defineProperty({ a: 1 }, "b", { value: 2, enumerable: true, writable: false, configurable: false });
    repeat(i => {
        check(describe(spreadLast({ [symbol]: 1, a: 2 }, i)), "z=" + i + ",a=2,Symbol(s)=1", "a symbol");
        check(describe(spreadLast(hidden, i)), "z=" + i + ",a=1,c=3", "a property that is not enumerable");
        check(describe(spreadLast(readOnly, i)), "z=" + i + ",a=1,b=2", "a property that is read-only");
        check(describe(restOf(readOnly)), "b=2", "the rest of an object with a read-only property");
        check(describe(spreadLast(Object.freeze({ a: 1, b: 2 }), i)), "z=" + i + ",a=1,b=2", "a frozen object");
        check(describe(spreadLast(Object.create({ inherited: 1 }, { own: { value: 2, enumerable: true } }), i)), "z=" + i + ",own=2", "inherited properties");
    });
}

{
    let calls = 0;
    const withGetter = { a: 1, get b() { return ++calls; }, c: 3 };
    repeat(i => check(describe(spreadLast(withGetter, 0)), "z=0,a=1,b=" + (i + 1) + ",c=3", "a getter"));
    check(calls, 100, "calls of the getter");

    const log = [];
    const proxy = new Proxy({ a: 1, b: 2 }, {
        ownKeys(target) { log.push("ownKeys"); return Reflect.ownKeys(target); },
        getOwnPropertyDescriptor(target, key) { log.push("describe " + key); return Reflect.getOwnPropertyDescriptor(target, key); },
        get(target, key) { log.push("get " + key); return target[key]; },
    });
    check(describe(spreadLast(proxy, 0)), "z=0,a=1,b=2", "a proxy");
    check(log.join(), "ownKeys,describe a,get a,describe b,get b", "the traps of a proxy");
}

{
    const parsed = JSON.parse('{"a":1,"__proto__":{"evil":true},"b":2}');
    repeat(i => {
        const copy = spreadLast(parsed, i);
        check(Object.getPrototypeOf(copy), Object.prototype, "the prototype after copying a property named __proto__");
        check(Reflect.ownKeys(copy).join(), "z,a,__proto__,b", "a property named __proto__");
    });
}

{
    const large = {};
    let expected = "z=0";
    for (let i = 0; i < 40; i++) {
        large["p" + i] = i;
        expected += ",p" + i + "=" + i;
    }
    repeat(() => check(describe(spreadLast(large, 0)), expected, "more properties than fit in the object"));
    repeat(() => check(describe(spreadTwo(large, large)), expected.slice(4), "more properties than fit in the object, twice"));

    const dictionary = {};
    for (let i = 0; i < 300; i++)
        dictionary["p" + i] = i;
    for (let i = 0; i < 298; i++)
        delete dictionary["p" + i];
    repeat(() => check(describe(spreadLast(dictionary, 0)), "z=0,p298=298,p299=299", "a dictionary"));
}

{
    const shapes = [{ a: 1 }, { b: 2 }, { a: 1, b: 2 }, { b: 2, a: 1 }, { c: 3, a: 1 }, {}, { z: "theirs" }];
    const expected = ["z=0,a=1", "z=0,b=2", "z=0,a=1,b=2", "z=0,b=2,a=1", "z=0,c=3,a=1", "z=0", "z=theirs"];
    repeat(i => check(describe(spreadLast(shapes[i % shapes.length], 0)), expected[i % shapes.length], "several shapes at one site"));
}

{
    const source = { a: 1, b: 2 };
    repeat(() => check(describe(spreadLast(source, 0)), "z=0,a=1,b=2", "before the source changes"));
    source.c = 3;
    repeat(() => check(describe(spreadLast(source, 0)), "z=0,a=1,b=2,c=3", "after a property is added to the source"));
    delete source.a;
    repeat(() => check(describe(spreadLast(source, 0)), "z=0,b=2,c=3", "after a property is deleted from the source"));
    Object.defineProperty(source, "b", { enumerable: false });
    repeat(() => check(describe(spreadLast(source, 0)), "z=0,c=3", "after a property stops being enumerable"));
}

{
    const copy = spreadLast({ a: 1 }, 0);
    copy.a = 2;
    copy.extra = 3;
    check(describe(spreadLast({ a: 1 }, 0)), "z=0,a=1", "a copy that was changed does not affect the next");
    check(describe(copy), "z=0,a=2,extra=3", "a copy can be changed");
}

function restInInlinedFunctions(x) {
    const first = (o => { const { a, ...rest } = o; return rest; })({ a: x, b: 1, c: 2 });
    const second = (o => { const { c, b, ...rest } = o; return rest; })({ a: x, b: 1, c: 2 });
    const { b, ...third } = { a: x, b: 1, c: 2 };
    return describe(first) + " " + describe(second) + " " + describe(third);
}
noInline(restInInlinedFunctions);
repeat(i => check(restInInlinedFunctions(i), "b=1,c=2 a=" + i + " a=" + i + ",c=2", "the rest, in functions that are inlined"));

function spreadOntoIndex(o) { return { 0: "zero", a: "mine", ...o }; }
noInline(spreadOntoIndex);
repeat(() => check(describe(spreadOntoIndex({ a: 1, b: 2 })), "0=zero,a=1,b=2", "a spread onto an object with an index"));
{
    const large = { };
    let expected = "0=zero,a=mine";
    for (let i = 0; i < 40; i++) {
        large["p" + i] = i;
        expected += ",p" + i + "=" + i;
    }
    repeat(() => check(describe(spreadOntoIndex(large)), expected, "a large spread onto an object with an index"));
}

for (let round = 0; round < 5; round++) {
    const source = { ["k" + round]: round, a: 1 };
    repeat(() => check(describe(spreadLast(source, 0)), "z=0,k" + round + "=" + round + ",a=1", "round " + round));
    fullGC();
    for (let i = 0; i < 50; i++)
        ({ ["unrelated" + round + "_" + i]: i });
    repeat(() => check(describe(spreadLast(source, 0)), "z=0,k" + round + "=" + round + ",a=1", "round " + round + " after a collection"));
}
console.log("passed");
