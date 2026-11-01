function check(actual, expected, what) {
    if (!Object.is(actual, expected))
        throw new Error(what + ": " + String(actual) + " instead of " + String(expected));
}
function thrownBy(f, ...args) {
    try {
        f(...args);
    } catch (error) {
        return error.constructor.name;
    }
    return "nothing";
}
function ropeOf(a, b) { return a + b; }
noInline(ropeOf);

function emptyMap() { let map = new Map(); return map; }
function emptySet() { let set = new Set(); return set; }
function emptySizes() { let map = new Map(), set = new Set(); return map.size + set.size; }
function mapOf(entries) { let map = new Map(entries); return map; }
function setOf(values) { let set = new Set(values); return set; }
function mapOfUndefined() { let map = new Map(undefined); return map; }
function shadowedMap(Map) { let map = new Map(); return map; }
function constructed(C) { let made = new C(); return made; }
class Table extends Map { constructor() { super(); this.made = new.target.name; } }
class Bag extends Set { }
function emptyTable() { let table = new Table(); return table; }
function emptyWeakMap() { let map = new WeakMap(); return map; }
for (let f of [emptyMap, emptySet, emptySizes, mapOf, setOf, mapOfUndefined, shadowedMap, constructed, emptyTable, emptyWeakMap])
    noInline(f);
for (let round = 0; round < 4; ++round) {
    for (let [made, C] of [[emptyMap(), Map], [emptySet(), Set], [mapOfUndefined(), Map], [constructed(Map), Map], [constructed(Set), Set]]) {
        check(Object.getPrototypeOf(made), C.prototype, "the prototype of an empty " + C.name);
        check(made.size, 0, "the size of an empty " + C.name);
        check(Object.getOwnPropertyNames(made).length, 0, "the properties of an empty " + C.name);
        check(Object.isExtensible(made), true, "an empty " + C.name + " can be extended");
        check([...made].length, 0, "the contents of an empty " + C.name);
        check(made.has(undefined), false, "an empty " + C.name + " has nothing");
        made.extra = 1;
        check(made.extra, 1, "a property of an empty " + C.name);
    }
    check(emptyMap() === emptyMap(), false, "two empty maps");
    check(emptyMap().set(1, 2).get(1), 2, "a map that was empty");
    check(emptySet().add(1).has(1), true, "a set that was empty");
    check(emptySizes(), 0, "the sizes of an empty map and an empty set");
    check(mapOf([[1, 2]]).get(1), 2, "new Map(entries)");
    check(setOf([1, 1]).size, 1, "new Set(values)");
    check(shadowedMap(Set) instanceof Set, true, "a parameter called Map");
    check(emptyTable().made, "Table", "a subclass of Map");
    check(emptyTable() instanceof Map, true, "a subclass of Map");
    check(Reflect.construct(Map, [], Table) instanceof Table, true, "Reflect.construct with another new.target");
    check(emptyWeakMap() instanceof WeakMap, true, "new WeakMap()");
}

const big = 2n ** 70n, symbol = Symbol(), object = {};
function keys(round) {
    return [
        ["text", "text"], [ropeOf("te", "xt"), "text"], ["context".substring(3), "text"], [ropeOf("long text that is a rope ", String(round)), "long text that is a rope " + round],
        ["中文", ropeOf("中", "文")], ["téxt", ropeOf("té", "xt")], ["", ropeOf("", "")],
        [1, 1], [1.5, 1.5], [-0, 0], [0, -0], [NaN, NaN], [2 ** 31, 2147483648], [-(2 ** 31), -2147483648], [1e300, 1e300], [round + 0.5 - 0.5, round],
        [big, 2n ** 70n], [7n, 7n], [symbol, symbol], [object, object], [undefined, undefined], [null, null], [true, true], [false, false],
    ];
}
function exercises(pairs) {
    let map = new Map(), set = new Set(), size = 0, log = [];
    for (let [key, same] of pairs) {
        let isNew = !map.has(same);
        log.push(map.has(key) === !isNew, map.get(key) === (isNew ? undefined : size - 1) || !isNew, set.has(key) === !isNew);
        log.push(map.set(key, size) === map, set.add(key) === set);
        size += isNew;
        log.push(map.size === size, set.size === size, map.has(same), set.has(same), map.get(same) === size - isNew);
        map.set(same, "again");
        set.add(same);
        log.push(map.get(key) === "again", map.size === size, set.size === size);
    }
    return log.every(passed => passed) ? size : -1;
}
function fills(count) {
    let map = new Map(), set = new Set();
    for (let i = 0; i < count; ++i) {
        map.set(i, i * 2).set("key" + i, { i }).set(i + 0.5, [i]);
        set.add(i).add("key" + i).add(i + 0.5);
    }
    let sum = 0;
    for (let i = 0; i < count; ++i) {
        if (!map.has(i) || !set.has("key" + i) || !set.has(i + 0.5) || map.has(-1 - i) || set.has("nokey" + i))
            return -1;
        sum += map.get(i) + map.get("key" + i).i + map.get(i + 0.5)[0];
    }
    return map.size === count * 3 && set.size === count * 3 ? sum : -2;
}
function integralDoubles(count) {
    let map = new Map(), half = 0.5;
    for (let i = 0; i < count; ++i)
        map.set(i * half * 2, i);
    let sum = 0;
    for (let i = 0; i < count; ++i)
        sum += map.get(i);
    return sum;
}
function inTailPosition(key) { "use strict"; let map = new Map(); map.set("key", "value"); return map.get(key); }
function hasInCondition(key) { let set = new Set(); set.add("key"); if (set.has(key)) return "yes"; return set.has("key") ? "no" : "broken"; }
function wrongCounts() { let map = new Map(), set = new Set(); return [map.set(), map.get(), map.has(), map.get(undefined, 1), map.set(1), map.get(1), map.set(2, 3, 4).get(2), set.add().has(), set.add(1, 2).has(2), map.size, set.size].map(String).join(); }
for (let f of [exercises, fills, integralDoubles, inTailPosition, hasInCondition, wrongCounts])
    noInline(f);
for (let round = 0; round < 3; ++round) {
    check(exercises(keys(round)), round < 2 ? 20 : 21, "the number of different keys");
    check(fills(300), 179400, "a map and a set that grow");
    check(integralDoubles(100), 4950, "doubles that are integers as keys");
    check(inTailPosition("key"), "value", "get in tail position");
    check(inTailPosition(ropeOf("k", "ey")), "value", "get of a rope in tail position");
    check(inTailPosition(1.5), undefined, "get of a double in tail position");
    check(hasInCondition("key"), "yes", "has in a condition");
    check(hasInCondition(ropeOf("k", "ey")), "yes", "has of a rope in a condition");
    check(hasInCondition("other"), "no", "has in a condition");
    check(wrongCounts(), "[object Map],undefined,true,undefined,[object Map],undefined,3,true,false,3,2", "calls with too few or too many arguments");
}

function ofUnknownReceiver(table, key) { return table.get(key) + "," + table.has(key) + "," + table.size; }
function addsToUnknownReceiver(table, key) { return table.add(key).size; }
function sizeOfAnything(o) { return o.size; }
for (let f of [ofUnknownReceiver, addsToUnknownReceiver, sizeOfAnything])
    noInline(f);
for (let round = 0; round < 3; ++round) {
    check(ofUnknownReceiver(new Map([[1, 2]]), 1), "2,true,1", "a map as a parameter");
    check(ofUnknownReceiver({ get() { return "got"; }, has() { return "has"; }, size: "size" }, 1), "got,has,size", "an object as a parameter");
    check(addsToUnknownReceiver(new Set(), 1), 1, "a set as a parameter");
    check(sizeOfAnything(new Map([[1, 2]])), 1, "the size of a map");
    check(sizeOfAnything(new Set([1, 2])), 2, "the size of a set");
    check(sizeOfAnything({ size: "mine" }), "mine", "the size of an object");
    check(sizeOfAnything("text"), undefined, "the size of a string");
}

function withOwnMethods(replace) {
    let map = new Map(), set = new Set();
    map.set(1, "one");
    set.add(1);
    if (replace) {
        map.get = function (key) { return "own get " + key; };
        map.has = function (key) { return "own has " + key; };
        map.set = function (key, value) { return "own set " + key + " " + value; };
        set.has = function (key) { return "own has " + key; };
        set.add = function (key) { return "own add " + key; };
    }
    return [map.get(1), map.has(1), typeof map.set(2, 3) === "string" ? map.set(2, 3) : "map", set.has(1), typeof set.add(2) === "string" ? set.add(2) : "set", map.size, set.size].join();
}
function withOwnSize(define) {
    let map = new Map(), set = new Set();
    map.set(1, 1);
    if (define) {
        Object.defineProperty(map, "size", { value: "own" });
        Object.defineProperty(set, "size", { get() { return "getter"; } });
    }
    return map.size + "," + set.size;
}
function withAnotherPrototype(change) {
    let map = new Map();
    map.set(1, "one");
    if (change)
        Object.setPrototypeOf(map, { get(key) { return "inherited get " + key; }, size: "inherited size" });
    return map.get(1) + "," + map.size;
}
function withNullPrototype() {
    let map = new Map();
    Object.setPrototypeOf(map, null);
    return map.size === undefined ? map.get(1) : "has a size";
}
function frozen() {
    let map = new Map(), set = new Set();
    Object.freeze(map);
    Object.freeze(set);
    return map.set(1, 2).get(1) + "," + set.add(1).has(1) + "," + map.size + "," + set.size;
}
for (let f of [withOwnMethods, withOwnSize, withAnotherPrototype, withNullPrototype, frozen])
    noInline(f);
for (let round = 0; round < 3; ++round) {
    check(withOwnMethods(false), "one,true,map,true,set,2,2", "a map and a set without own methods");
    check(withOwnMethods(true), "own get 1,own has 1,own set 2 3,own has 1,own add 2,1,1", "a map and a set with own methods");
    check(withOwnSize(false), "1,0", "a map and a set without an own size");
    check(withOwnSize(true), "own,getter", "a map and a set with an own size");
    check(withAnotherPrototype(false), "one,1", "a map with its prototype");
    check(withAnotherPrototype(true), "inherited get 1,inherited size", "a map with another prototype");
    check(thrownBy(withNullPrototype), "TypeError", "a map without prototype");
    check(frozen(), "2,true,1,1", "a frozen map and a frozen set");
}

function manyCollections(count) {
    let all = [];
    for (let i = 0; i < count; ++i) {
        let map = new Map(), set = new Set();
        map.set("i", { i });
        set.add("s" + i);
        all.push(map, set);
    }
    return all;
}
function oldCollections(map, set, i) { map.set("key", { i }); set.add({ i }); return map.size + set.size; }
noInline(manyCollections);
noInline(oldCollections);
for (let round = 0; round < 3; ++round) {
    let all = manyCollections(500);
    gc();
    for (let i = 0; i < 500; ++i) {
        check(all[2 * i].get("i").i, i, "one of many maps");
        check(all[2 * i + 1].has("s" + i), true, "one of many sets");
        check(all[2 * i].size + all[2 * i + 1].size, 2, "the sizes of one of many maps and sets");
    }
}
function keepsNewValues() {
    let map = new Map(), set = new Set();
    map.set("key", null);
    gc();
    for (let i = 0; i < 100; ++i) {
        map.set("key", { i });
        set.add({ i });
        if (!(i % 16))
            edenGC();
        if (map.get("key").i !== i || set.size !== i + 1)
            return false;
    }
    let i = 0;
    for (let o of set) {
        if (o.i !== i++)
            return false;
    }
    return true;
}
noInline(keepsNewValues);
check(keepsNewValues(), true, "new objects in an old map and an old set");
console.log("passed");
