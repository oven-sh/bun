// Members of built-in prototypes are read by name from receivers of unknown type. Then other members of the same prototype are deleted,
// many names are added to it and deleted again, and the same members are read once more.
function hide(value) {
    return JSON.parse("[0]", function (key, element) { return key === "" ? value : element; });
}

function describe(receiver, names) {
    const parts = [];
    for (const name of names) {
        let value;
        try { value = receiver[name]; } catch (error) { value = "threw " + error.constructor.name; }
        parts.push(String(name) + "=" + (typeof value === "function" ? "function " + value.name : String(value)));
    }
    return parts.join(" ");
}

function size(o) { return o.size; }
function values(o) { return o.values; }
function has(o) { return o.has; }
function getTime(o) { return o.getTime; }
function toJSON(o) { return o.toJSON; }
function valueOf(o) { return o.valueOf; }
function slice(o) { return o.slice; }
function split(o) { return o.split; }
function normalize(o) { return o.normalize; }
function constructorOf(o) { return o.constructor; }
const readers = [size, values, has, getTime, toJSON, valueOf, slice, split, normalize, constructorOf];

function readAll(receiver) {
    const parts = [];
    for (const read of readers) {
        const value = read(receiver);
        parts.push(read.name + "=" + (typeof value === "function" ? "function " + value.name : String(value)));
    }
    return parts.join(" ");
}

function firstAbsentName(o) { return o.aNameThatNothingHas; }
function secondAbsentName(o) { return o.anotherNameThatNothingHas; }

function deleteMembers(prototype, names) {
    let deleted = 0;
    for (const name of names) {
        if (Reflect.deleteProperty(prototype, name))
            deleted++;
    }
    return deleted;
}

function addAndDelete(prototype, prefix, count) {
    for (let i = 0; i < count; i++) {
        prototype[prefix + i] = i;
        delete prototype[prefix + i];
    }
}

const others = [{}, { a: 1 }, function () { }, [1], hide({ size: "own" })];

function scene(title, receiver, prototype, membersToDelete, namesToRead) {
    let before = "";
    for (let i = 0; i < 80; i++) {
        before = readAll(receiver) + " | " + describe(receiver, namesToRead);
        for (const other of others)
            readAll(other);
    }
    console.log(title, "at first:", before);
    console.log(title, "deleted:", deleteMembers(prototype, membersToDelete));
    console.log(title, "same behind the deletions:", before === readAll(receiver) + " | " + describe(receiver, namesToRead));
    for (const count of [10, 70, 300]) {
        addAndDelete(prototype, "added" + title + count + "x", count);
        console.log(title, "same behind", count, "additions:", before === readAll(receiver) + " | " + describe(receiver, namesToRead));
        for (let i = 0; i < 40; i++) {
            firstAbsentName(receiver);
            secondAbsentName(receiver);
        }
        for (let i = 0; i < 3; i++)
            console.log(title, "same behind reads of absent names:", before === readAll(receiver) + " | " + describe(receiver, namesToRead));
    }
    prototype["kept" + title] = title;
    console.log(title, "a new member:", receiver["kept" + title], describe(receiver, namesToRead) === before.split(" | ")[1]);
}

scene("Map", hide(new Map([[1, "one"]])), Map.prototype, ["getOrInsert", "getOrInsertComputed"],
    ["clear", "delete", "entries", "forEach", "get", "has", "keys", "set", "size", "values", "constructor", Symbol.iterator, Symbol.toStringTag]);
scene("Set", hide(new Set([1, 2])), Set.prototype, ["union", "intersection", "difference", "symmetricDifference", "isSubsetOf", "isSupersetOf", "isDisjointFrom"],
    ["add", "clear", "delete", "entries", "forEach", "has", "keys", "size", "values", "constructor", Symbol.iterator, Symbol.toStringTag]);
scene("WeakMap", hide(new WeakMap()), WeakMap.prototype, ["getOrInsert", "getOrInsertComputed"],
    ["delete", "get", "has", "set", "constructor", Symbol.toStringTag]);
scene("Date", hide(new Date(86400000)), Date.prototype, ["toString", "toLocaleString", "toLocaleDateString", "toLocaleTimeString"],
    ["toISOString", "valueOf", "getTime", "getUTCFullYear", "getUTCDate", "setTime", "toJSON", "toUTCString", "constructor", Symbol.toPrimitive]);
scene("String", hide("text"), String.prototype, ["anchor", "big", "bold", "blink", "fixed", "fontcolor", "fontsize", "italics", "link", "small", "strike", "sub", "sup", "at", "trim", "trimStart", "trimLeft", "trimEnd", "trimRight"],
    ["length", "toString", "valueOf", "charAt", "indexOf", "replace", "slice", "split", "normalize", "toUpperCase", "startsWith", "constructor", Symbol.iterator]);

const map = hide(new Map([[1, "one"], [2, "two"]]));
console.log(map.size, map.get(2), [...map.values()].join(), map.set(3, "three").size, map.has(3));
const set = hide(new Set([1, 2]));
console.log(set.size, set.has(2), [...set.values()].join(), set.add(3).size);
const date = hide(new Date(86400000));
console.log(date.getTime(), date.toISOString(), JSON.stringify(date));
const text = hide("a,b");
console.log(text.split(",").length, text.slice(1), text.normalize(), text.toUpperCase());
