// `{ __proto__: null }` makes an object without a prototype, whatever has become of Object.create, and only that spelling does.
const lines = [];
function describe(object) {
    const prototype = Object.getPrototypeOf(object);
    return (prototype === null ? "no prototype" : prototype === Object.prototype ? "Object.prototype" : "another prototype") + " own [" + Reflect.ownKeys(object).map(String).join() + "] "
        + ("toString" in object) + " " + Object.isExtensible(object);
}
const originalCreate = Object.create;
let calls = 0;
try {
    Object.create = function () { calls++; return { spoiled: true }; };
} catch {
    // A compiled program may refuse the store.
}
const __proto__ = null;
const makers = {
    "the literal": () => ({ __proto__: null }),
    "with a comma": () => ({ __proto__: null, }),
    "in parentheses": () => ({ __proto__: (null) }),
    "a string as the key": () => ({ "__proto__": null }),
    "a computed key": () => ({ ["__proto__"]: null }),
    "shorthand": () => ({ __proto__ }),
    "a method": () => ({ __proto__() { return null; } }),
    "undefined": () => ({ __proto__: undefined }),
    "a number": () => ({ __proto__: 0 }),
    "a variable that is null": () => { const nothing = null; return { __proto__: nothing }; },
    "and a member": () => ({ __proto__: null, a: 1 }),
    "a member and": () => ({ a: 1, __proto__: null }),
    "and a spread": () => ({ __proto__: null, ...{ b: 2 } }),
    "another object": () => ({ __proto__: { inherited: 1 } }),
};
for (const [title, make] of Object.entries(makers)) {
    const said = new Set();
    for (let round = 0; round < 5; round++)
        said.add(describe(make()));
    lines.push(title + ": " + [...said].join(" > "));
}
lines.push("calls of what stands in Object.create: " + calls);
try {
    Object.create = originalCreate;
} catch { }

// It serves as a map, as a record and as a prototype.
const names = ["constructor", "toString", "__proto__", "hasOwnProperty", "a", "b", "1", "length"];
let sum = 0;
for (let round = 0; round < 300; round++) {
    const map = { __proto__: null };
    for (let i = 0; i < names.length; i++) {
        if (map[names[i]] !== undefined || names[i] in map)
            sum += 1e6;
        map[names[i]] = round + i;
    }
    for (const name in map)
        sum += map[name];
    delete map[names[round & 7]];
    sum += Object.keys(map).length;
}
lines.push("as a map: " + sum);
const record = { __proto__: null };
record.x = 1;
record.y = "two";
record.z = { __proto__: null };
record.z.deep = true;
lines.push("as a record: " + JSON.stringify(record) + " " + describe(record) + " " + describe(record.z));
const below = { __proto__: record };
const instance = Object.setPrototypeOf({ own: 1 }, { __proto__: null });
lines.push("as a prototype: " + below.x + " " + ("toString" in below) + " " + describe(instance));
const frozen = Object.freeze({ __proto__: null });
lines.push("frozen: " + Object.isFrozen(frozen) + " " + describe(frozen));
try {
    lines.push(String({ __proto__: null }));
} catch (error) {
    lines.push("as a string: " + error.constructor.name);
}
lines.push("two are two: " + ({ __proto__: null } === { __proto__: null }) + " " + (typeof { __proto__: null }));
console.log(lines.join("\n"));
