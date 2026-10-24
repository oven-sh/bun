// Map.prototype.set and Set.prototype.add on present and absent keys, lookups in weak tables, new Map() in a loop.
const out: string[] = [];
function show(value: unknown): string {
    if (typeof value === "string") return JSON.stringify(value);
    if (Object.is(value, -0)) return "-0";
    if (Array.isArray(value)) return "array of " + value.length;
    if (typeof value === "object" && value !== null) return "object";
    return String(value);
}
function say(...parts: unknown[]) {
    out.push(parts.map(show).join(" "));
}

function hugeArray(): number[] {
    const values: number[] = [];
    for (let i = 0; i < 100000; i++) values.push(i);
    return values;
}
const REPLACEMENTS: unknown[] = [null, true, "text", 1.5, hugeArray(), false, undefined, 7, -0, NaN];

function replaceTyped(name: string, map: Map<string, unknown>, key: string) {
    for (const value of REPLACEMENTS) {
        const returned = map.set(key, value);
        say(name, returned === map, show(map.get(key)), map.has(key), map.size);
    }
}
function replaceUntyped(name: string, map: any, key: any) {
    for (const value of REPLACEMENTS) {
        const returned = map.set(key, value);
        say(name, returned === map, show(map.get(key)), map.has(key), map.size);
    }
}
function smallStringMap(): Map<string, unknown> {
    const map = new Map<string, unknown>();
    map.set("key", null);
    map.set("other", false);
    return map;
}
function storesOfStringKeys() {
    replaceTyped("typed", smallStringMap(), "key");
    replaceUntyped("untyped", smallStringMap(), "key");
    replaceTyped("built key", smallStringMap(), ["k", "e", "y"].join(""));
    const constants = new Map<string, unknown>([["key", 1], ["other", 2], ["third", 3]]);
    replaceTyped("constant table", constants, "key");
    say("neighbors", show(constants.get("other")), show(constants.get("third")));
    const many = smallStringMap();
    for (let i = 0; i < 300; i++) many.set("key" + i, i);
    replaceTyped("many keys", many, "key200");
    say("order", [...many.keys()].slice(0, 4).join(","), many.size);
}

function storesOfOtherKeys() {
    const object = { name: "object" };
    const symbol = Symbol("symbol");
    const numbers = new Map<number, unknown>([[1, "one"], [2.5, "two and a half"]]);
    for (const value of REPLACEMENTS) {
        numbers.set(1, value);
        numbers.set(2.5, value);
        say("number keys", show(numbers.get(1)), show(numbers.get(2.5)), numbers.size);
    }
    const objects = new Map<object, unknown>([[object, 0]]);
    const symbols = new Map<symbol, unknown>([[symbol, 0]]);
    const anything: Map<unknown, unknown> = new Map<unknown, unknown>([[object, 0], [symbol, 0], ["text", 0], [1, 0]]);
    for (const value of REPLACEMENTS) {
        objects.set(object, value);
        symbols.set(symbol, value);
        anything.set(object, value).set(symbol, value).set("text", value).set(1, value);
        say("other keys", show(objects.get(object)), show(symbols.get(symbol)), show(anything.get("text")), anything.size);
    }
}

function returnedReceivers() {
    const a = { name: "a" };
    const b = { name: "b" };
    const map = new Map<object, number>();
    say("chained set", map.set(a, 1).set(b, 2) === map, map.get(a), map.get(b), map.size);
    const strings = new Map<string, number>();
    say("chained string set", strings.set("a", 1).set("b", 2).set("a", 3) === strings, strings.get("a"), strings.size);
    const set = new Set<string>();
    say("add absent", set.add("z") === set, "add present", set.add("z") === set, set.size);
    const anySet: any = new Set();
    say("untyped add", anySet.add(1).add("1").add(1).add(a).add(a) === anySet, anySet.size);
}

function orderOfAdds() {
    const strings = new Set<string>(["c", "a"]);
    strings.add("b").add("a").add("d").add("c");
    say("string order", [...strings].join(","));
    const numbers = new Set<number>([3, 1]);
    numbers.add(2).add(1).add(4).add(3).add(1.5).add(1.5);
    say("number order", [...numbers].join(","));
    const mixed = new Set<unknown>();
    mixed.add("1").add(1).add(null).add(undefined).add("1").add(null).add(1n).add(1n).add(true);
    say("mixed order", [...mixed].map(show).join(","));
}

interface Labeled {
    label: string;
}
function fresh(number: number): Labeled {
    return { label: "fresh " + number };
}
function makeGarbage() {
    const garbage: Labeled[] = [];
    for (let i = 0; i < 20000; i++) garbage.push(fresh(i));
    return garbage.length;
}
function storesIntoOldMaps() {
    const byString = new Map<string, Labeled>();
    const byNumber = new Map<number, Labeled>();
    const untyped: any = new Map();
    for (let i = 0; i < 64; i++) {
        byString.set("key" + i, fresh(i));
        byNumber.set(i, fresh(i));
        untyped.set("key" + i, fresh(i));
    }
    Bun.gc(true);
    Bun.gc(true);
    for (let round = 0; round < 3; round++) {
        byString.set("key7", fresh(1000 + round));
        byNumber.set(7, fresh(2000 + round));
        untyped.set("key7", fresh(3000 + round));
        makeGarbage();
        Bun.gc(true);
        say("old maps", byString.get("key7")!.label, byNumber.get(7)!.label, untyped.get("key7").label);
    }
}

function weakGet(table: WeakMap<any, number>, key: any) {
    return table.get(key);
}
function weakHas(table: WeakMap<any, number>, key: any) {
    return table.has(key);
}
function weakSetHas(table: WeakSet<any>, key: any) {
    return table.has(key);
}
function fillWeakTables(map: WeakMap<object, number>, set: WeakSet<object>, retained: object[]) {
    for (let i = 0; i < 1000; i++) {
        const key = { number: i };
        map.set(key, i);
        set.add(key);
        if (i % 2) retained.push(key);
    }
}
function weakTables() {
    const map = new WeakMap<object, number>();
    const set = new WeakSet<object>();
    const keys: object[] = [];
    for (let i = 0; i < 1000; i++) {
        const key = { number: i };
        keys.push(key);
        map.set(key, i * 2);
        set.add(key);
    }
    const count = () => {
        let sum = 0;
        let inMap = 0;
        let inSet = 0;
        for (const key of keys) {
            sum += weakGet(map, key) ?? 0;
            if (weakHas(map, key)) inMap++;
            if (weakSetHas(set, key)) inSet++;
        }
        return [sum, inMap, inSet].join(" ");
    };
    say("weak tables", count());
    for (let i = 0; i < 1000; i += 2) {
        map.delete(keys[i]);
        set.delete(keys[i]);
    }
    say("after delete", count());

    const retained: object[] = [];
    const collectedMap = new WeakMap<object, number>();
    const collectedSet = new WeakSet<object>();
    fillWeakTables(collectedMap, collectedSet, retained);
    makeGarbage();
    Bun.gc(true);
    Bun.gc(true);
    let sum = 0;
    let found = 0;
    for (const key of retained) {
        sum += weakGet(collectedMap, key) ?? 0;
        if (weakSetHas(collectedSet, key)) found++;
    }
    say("after collection", retained.length, sum, found);
    say("never added", weakGet(collectedMap, {}), weakHas(collectedMap, {}), weakSetHas(collectedSet, {}));
    say("not objects", weakGet(map, 1), weakHas(map, "a"), weakSetHas(set, undefined), weakGet(map, null), weakSetHas(set, 1.5), weakHas(map, true));
}

function newMapsInLoop() {
    let sum = 0;
    let last = new Map<number, number>();
    for (let i = 0; i < 100000; i++) {
        const map = new Map<number, number>();
        map.set(i, i + 1);
        sum += map.get(i)! + map.size;
        last = map;
    }
    say("new maps", sum, last.size, last.get(99999));
}

function absentKeys() {
    const strings = new Map<string, number>([["present", 1]]);
    const numbers = new Map<number, number>([[1, 1]]);
    const empty = new Map<unknown, number>();
    const stringSet = new Set<string>(["present"]);
    const numberSet = new Set<number>([1]);
    const emptySet = new Set<unknown>();
    say("absent get", strings.get("absent"), numbers.get(2), empty.get("x"), empty.get(1), empty.get({}));
    say("absent has", strings.has("absent"), numbers.has(2), empty.has("x"), stringSet.has("absent"), numberSet.has(2), emptySet.has(null));
    say("absent stores", strings.set("absent", 2).get("absent"), numbers.set(2, 2).get(2), empty.set("x", 3).get("x"), stringSet.add("absent").size, numberSet.add(2).size, emptySet.add(null).size);
}

function keyIdentity(map: Map<unknown, string>, set: Set<unknown>) {
    const zero = 0;
    map.set(-0, "zero");
    set.add(-0);
    say("zeros", map.get(zero), map.has(-0), set.has(zero), Object.is([...map.keys()][0], 0), map.set(0, "again").size, set.add(0).size);
    map.set(NaN, "not a number");
    set.add(NaN);
    say("NaN", map.get(0 / zero), set.has(0 / zero), map.set(NaN, "again").get(NaN));
    map.set(1, "number");
    map.set("1", "string");
    set.add(1);
    say("one", map.get(1), map.get("1"), set.has("1"), set.has(1), map.size);
    map.set(1n, "bigint");
    map.set(10n ** 20n, "big");
    set.add(10n ** 20n);
    say("bigints", map.get(BigInt(1)), map.get(1), map.get(10n ** 19n * 10n), set.has(10n ** 19n * 10n), set.has(10n ** 19n), map.has(2n));
}

storesOfStringKeys();
storesOfOtherKeys();
returnedReceivers();
orderOfAdds();
storesIntoOldMaps();
weakTables();
newMapsInLoop();
absentKeys();
keyIdentity(new Map<unknown, string>(), new Set<unknown>());
console.log(out.join("\n"));
