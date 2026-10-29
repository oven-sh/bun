// hasOwnProperty.call(x, "name") and Object.hasOwn(x, "name") where x may be undefined or null, an object, a list or a primitive: what they answer, what they throw and say, and in which order the operands are converted.
function attempt(run) { try { return String(run()); } catch (error) { return error.name; } }
const has = Object.prototype.hasOwnProperty, tag = Object.prototype.toString, slice = Array.prototype.slice;
// A store that no build can place: with it nobody can prove that the functions above are as they were, but for the lock on them.
const poke = (target, key, value) => { target[key] = value; };
poke(globalThis[["pro", "cess"].join("")].env, String(Math.random()), "1");
console.log("on nothing: " + [attempt(() => has.call(undefined, "a")), attempt(() => has.call(null, "a")), attempt(() => Object.hasOwn(undefined, "a")), attempt(() => Object.hasOwn(null, "a")), attempt(() => slice.call(undefined)), tag.call(undefined)].join(" "));
const messageOf = run => { try { run(); return "nothing thrown"; } catch (error) { return error.message.replace(/ \(.*/, ""); } };
const maybe = flag => (flag ? undefined : { a: 1 }), orNull = flag => (flag ? null : [1]);
console.log("what it says: " + [messageOf(() => has.call(maybe(true), "a")), messageOf(() => has.call(orNull(true), "a")), messageOf(() => Object.hasOwn(maybe(true), "a")), messageOf(() => Object.hasOwn(orNull(true), "length"))].join(" | "));
console.log("what may be missing and is not: " + [has.call(maybe(false), "a"), has.call(orNull(false), "length"), has.call(orNull(false), 0), has.call(orNull(false), "pos"), Object.hasOwn(maybe(false), "b"), Object.hasOwn(orNull(false), "0")].join(" "));
let order = "";
const key = { toString() { order += "key "; return "a"; } };
console.log("the key is converted first by the method, second by the function: " + [attempt(() => has.call(maybe(true), key)), attempt(() => Object.hasOwn(maybe(true), key)), order].join(" "));
const hasProperty = (map, key) => has.call(map, key);
const isNodeArray = list => hasProperty(list, "pos") && hasProperty(list, "end");
const marked = Object.assign([1, 2], { pos: 0, end: 5 }), half = Object.assign([1], { pos: 0 });
console.log("lists with names of their own: " + [isNodeArray(marked), isNodeArray(half), isNodeArray([1]), isNodeArray({ pos: 1, end: 2 }), isNodeArray("text"), attempt(() => isNodeArray(undefined)), attempt(() => isNodeArray(null))].join(" "));
const kinds = [{ a: 1 }, Object.create({ a: 1 }), Object.create(null), [], "a", 5, true, 10n, Symbol.iterator, () => 1, new Proxy({ a: 1 }, {}), new Proxy({}, { getOwnPropertyDescriptor() { return { value: 1, configurable: true }; } }), new String("a"), Object.freeze({ a: undefined }), { get a() { throw new RangeError("never read"); } }, undefined, null];
console.log("every kind, by the method: " + kinds.map(kind => attempt(() => has.call(kind, "a"))).join(" "));
console.log("every kind, by the function: " + kinds.map(kind => attempt(() => Object.hasOwn(kind, "a"))).join(" "));
console.log("every kind, an index: " + kinds.map(kind => attempt(() => has.call(kind, 0))).join(" "));
console.log("every kind, length: " + kinds.map(kind => attempt(() => has.call(kind, "length"))).join(" "));
console.log("every kind, its tag: " + kinds.map(kind => attempt(() => tag.call(kind))).join(" "));
