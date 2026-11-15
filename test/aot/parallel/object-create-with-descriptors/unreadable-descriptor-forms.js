// Forms whose descriptors the compiler cannot read at build time, or whose reading runs code. Each prints what plain Bun prints.
const key = Symbol("key");
const seen = [];
const show = object => Reflect.ownKeys(object).map(name => String(name) + ":" + JSON.stringify(Object.getOwnPropertyDescriptor(object, name), (_, value) => (typeof value === "function" ? "function" : value === undefined ? "undefined" : value))).join(" ");
function tryTo(run) { try { return String(run()); } catch (error) { return error.constructor.name + ": " + error.message; } }
const shared = { value: 1, enumerable: true };
const sharedMap = { [key]: shared, name: { value: 2 } };
seen.push(show(Object.create(null, sharedMap)), show(Object.create(null, { [key]: shared })), JSON.stringify(shared));
function unknownAttribute(flag) { return Object.create(null, { [key]: { value: 1, enumerable: flag, writable: !flag } }); }
seen.push(show(unknownAttribute(true)), show(unknownAttribute(false)), show(unknownAttribute(0)), show(unknownAttribute("yes")));
function badGetter(getter) { return Object.create(null, { [key]: { get: getter } }); }
seen.push(tryTo(() => show(badGetter(5))), tryTo(() => show(badGetter(() => 1))), tryTo(() => show(badGetter(undefined))));
function both(value) { return Object.create(null, { [key]: { value, get() { return 1; } } }); }
seen.push(tryTo(() => show(both(1))));
function notAnObject(descriptor) { return Object.create(null, { [key]: descriptor }); }
seen.push(tryTo(() => show(notAnObject(1))), tryTo(() => show(notAnObject(null))), tryTo(() => show(notAnObject({ value: 3 }))));
function spreadDescriptor(more) { return Object.create(null, { [key]: { value: 1, ...more } }); }
seen.push(show(spreadDescriptor({ enumerable: true })), show(spreadDescriptor({})));
function getterInMap(log) { return Object.create(null, { get [key]() { log.push("map getter ran"); return { value: 4 }; } }); }
const log = [];
seen.push(show(getterInMap(log)), log.join());
function getterInDescriptor(log) { return Object.create(null, { [key]: { get value() { log.push("descriptor getter ran"); return 5; } } }); }
seen.push(show(getterInDescriptor(log)), log.join());
function indexKeys() { return Object.create(null, { b: { value: 1, enumerable: true }, 1: { value: 2, enumerable: true }, a: { value: 3, enumerable: true }, 0: { value: 4, enumerable: true } }); }
seen.push(show(indexKeys()), Object.keys(indexKeys()).join());
function mixedKeys() { return Object.create(null, { [key]: { value: 1 }, later: { value: 2, enumerable: true }, [Symbol.iterator]: { value: 3 }, last: { value: 4 } }); }
seen.push(show(mixedKeys()));
function keptDescriptor() { const descriptor = { value: 1, writable: true }; const made = Object.create(null, { [key]: descriptor }); descriptor.value = 2; return [made, descriptor]; }
seen.push(show(keptDescriptor()[0]), JSON.stringify(keptDescriptor()[1]));
function keptMap() { const map = { [key]: { value: 1 } }; const made = Object.create(null, map); return [made, map]; }
seen.push(show(keptMap()[0]), show(keptMap()[1]));
function descriptorIsPrototype() { const both = { value: 1 }; return Object.create(both, { [key]: both }); }
seen.push(show(descriptorIsPrototype()), String(descriptorIsPrototype().value));
function undefinedMap(prototype) { return Object.create(prototype, undefined); }
seen.push(show(undefinedMap(null)), tryTo(() => Object.create(null, null)));
function unknownKey(name) { return Object.create(null, { [name]: { value: 1, enumerable: true } }); }
seen.push(show(unknownKey("x")), show(unknownKey(3)), show(unknownKey(key)), show(unknownKey("__proto__")), show(unknownKey({ toString() { return "converted"; } })));
function sameKeyTwice() { return Object.create(null, { [key]: { value: 1 }, [key]: { value: 2, enumerable: true } }); }
seen.push(show(sameKeyTwice()));
console.log(seen.join("\n"));
