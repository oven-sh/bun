// The first element of an ordinary object: whatever lies on its prototypes, whatever it becomes.
let failures = 0;
const check = (name, found, expected) => { if (!Object.is(found, expected) && ++failures < 20) console.log(name, "is", found, "and not", expected); };
const fill = (object, key, value) => { object[key] = value; return object; };
const text = object => Object.keys(object).map(key => key + ":" + String(object[key])).join();
const makes = [() => ({}), () => Object.create(null), () => ({ a: 1 }), () => ({ a: 1, b: 2, c: 3, d: 4, e: 5, f: 6, g: 7, h: 8 }), () => new (class Point { constructor() { this.x = 1; } })(), () => JSON.parse("{}"), () => JSON.parse('{"k":1}'), () => Object.assign({}, { z: 1 }), () => ({ ...{ y: 2 } }), () => Object.create({ inherited: 1 }), () => new Object()];
const values = [0, -1, 2147483647, 2147483648, 0.5, NaN, -0, "s", null, undefined, true, {}, Symbol.iterator, 10n];
for (let round = 0; round < 40; ++round) {
    for (let m = 0; m < makes.length; ++m) {
        for (const key of [0, 1, 2, 3, 7, 15, 16, 17, 100, 5000, "4", 4294967294, 4294967295]) {
            const value = values[(round + m) % values.length], object = fill(makes[m](), key, value);
            check("value " + m + " " + String(key), object[key], value);
            check("own " + m, Object.hasOwn(object, key), true);
            const other = values[(round + 3) % values.length];
            fill(object, 1, other);
            check("second " + m, object[1], other);
            check("absent " + m, object[6], undefined);
            check("length " + m, "length" in object, false);
            delete object[key];
            check("deleted " + m, Object.hasOwn(object, key), false);
        }
    }
    check("text", text(fill(fill(fill({ q: 1 }, 2, "c"), 0, "a"), 1, "b")), "0:a,1:b,2:c,q:1");
    if (round % 10 === 0 && globalThis.Bun) Bun.gc(true);
}
class Strict { static store(make, key) { try { make()[key] = 1; return "stored"; } catch (e) { return e.constructor.name; } } }
for (let i = 0; i < 3; ++i) {
    check("frozen", Strict.store(() => Object.freeze({}), 0), "TypeError");
    check("sealed", Strict.store(() => Object.seal({}), 1), "TypeError");
    check("not extensible", Strict.store(() => Object.preventExtensions({ a: 1 }), 2), "TypeError");
    check("proxy", (() => { const seen = []; fill(new Proxy({}, { set(t, k, v) { seen.push(k); t[k] = v; return true; } }), 3, 4); return seen.join(); })(), "3");
}
const own = {};
Object.defineProperty(own, "a", { get() { return 1; } });
check("beside a getter", text(fill(own, 0, 9)), "0:9");
let heard = 0;
const parent = { set 5(value) { heard += value; }, get 5() { return -1; } };
for (let i = 1; i <= 3; ++i) { const child = fill(Object.create(parent), 5, i); check("inherited setter", Object.hasOwn(child, 5), false); check("read", child[5], -1); }
check("heard", heard, 6);
// Object.prototype takes no elements in an executable.
let isOpen = true;
try { Object.prototype[9] = "above"; } catch { isOpen = false; }
if (isOpen) {
    const before = fill({}, 4, 1);
    check("read above", fill({}, 8, 1)[9], "above");
    check("store over", fill({}, 9, "own")[9], "own");
    delete Object.prototype[9];
    Object.defineProperty(Object.prototype, "11", { get() { return "getter"; }, set(value) { heard = value; }, configurable: true });
    const late = fill({}, 11, 77);
    check("setter above", Object.hasOwn(late, 11), false);
    check("heard above", heard, 77);
    check("read by getter", late[11], "getter");
    check("beside it", fill({}, 3, 5)[3], 5);
    check("made before", before[4] === 1 && before[11] === "getter", true);
    delete Object.prototype[11];
    check("behind it", fill({}, 11, 5)[11], 5);
}
console.log(failures);
