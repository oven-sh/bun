// Object.keys, values, entries and getOwnPropertyNames of a value of which nothing is known: the operation converts what is no object and leaves undefined and null to the function, which refuses them in its own words.
function keysOf(x) { try { return Object.keys(x).join(); } catch (error) { return error.name + ": " + error.message; } }
function valuesOf(x) { try { return Object.values(x).join(); } catch (error) { return error.name + ": " + error.message; } }
function entriesOf(x) { try { return Object.entries(x).map(p => p.join("=")).join(); } catch (error) { return error.name + ": " + error.message; } }
function namesOf(x) { try { return Object.getOwnPropertyNames(x).join(); } catch (error) { return error.name + ": " + error.message; } }
function frozen(x) { try { const y = Object.freeze(x); return [y === x, Object.isFrozen(x)].join(); } catch (error) { return error.name + ": " + error.message; } }
function largest(a, b) { return [Math.max(a, b), Math.min(a, b), Math.max(a), Math.min(), Math.max(a, b, 7)].join(); }
class Point { constructor() { this.x = 1; this.y = 2; } get z() { return 3; } }
const grown = { a: 1 }; grown.b = 2; grown[3] = "three"; grown[Symbol("s")] = 4;
Object.defineProperty(grown, "hidden", { value: 5, enumerable: false });
const proxy = new Proxy({ p: 1 }, { ownKeys() { return ["p", "q"]; }, getOwnPropertyDescriptor(t, k) { return { value: k, enumerable: true, configurable: true }; } });
const all = [{ a: 1, b: 2 }, new Point(), grown, [7, 8], "ab", 5, true, null, undefined, proxy, JSON.parse('{"j":1,"k":[2]}'), function f() {}, new Map([[1, 2]]), Object.create({ up: 1 })];
for (const x of all) console.log(keysOf(x), "|", valuesOf(x), "|", entriesOf(x), "|", namesOf(x));
for (const x of [{ a: 1 }, new Point(), [1], "s", 5, null, undefined, function () {}]) console.log(frozen(x));
console.log(largest(1, 2), largest(2.5, -1), largest(0, -0), largest(NaN, 1), largest("3", 2), largest({ valueOf() { return 9; } }, 1), largest(undefined, 1), largest(null, -1));
