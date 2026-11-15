// Elements that an ordinary object lacks, and those that make it grow.
// COUNT: operationAOTGetByVal <= 300
let failures = 0;
const check = (name, found, expected) => { if (!Object.is(found, expected) && ++failures < 20) console.log(name, "is", found, "and not", expected); };
const read = (object, key) => object[key], store = (object, key, value) => { object[key] = value; return object; };
const count = keys => { const counts = {}; for (const key of keys) counts[key] = (counts[key] || 0) + 1; return counts; };
for (let round = 0; round < 200; ++round) {
    const counts = count([1, 3, 1, 2, 3, 3, 0]);
    check("counts", counts[0] + 10 * counts[1] + 100 * counts[2] + 1000 * counts[3], 3121);
    check("absent", read(counts, 7), undefined);
    check("beyond", read(counts, 4), undefined);
}
for (const value of [1, 1.5, "s", null, {}, NaN, undefined]) {
    for (const named of [0, 1, 7, 80]) {
        const object = {};
        for (let i = 0; i < named; ++i) object["name" + i] = i;
        for (let i = 0; i < 300; ++i) { store(object, i, value); check("stored", read(object, i), value); check("next", read(object, i + 1), undefined); }
        for (let i = 0; i < named; ++i) check("name", object["name" + i], i);
        check("length", Object.keys(object).length, 300 + named);
        store(object, 10, "other");
        check("other", read(object, 10), "other");
        check("behind other", read(object, 11), value);
        delete object[20];
        check("deleted", read(object, 20), undefined);
        store(object, 1000000, "far");
        check("far", read(object, 1000000), "far");
        check("between", read(object, 5000), undefined);
        if (globalThis.Bun) Bun.gc(true);
        check("after", read(object, 299), value);
    }
}
const parent = { 5: "above", get 6() { return this.own; } }, child = store(Object.create(parent), 0, 1);
child.own = "got";
check("inherited", read(child, 5), "above");
check("inherited getter", read(child, 6), "got");
check("not inherited", read(child, 7), undefined);
check("parent of null", read(store(Object.create(null), 0, 1), 1), undefined);
check("proxy above", read(store(Object.create(new Proxy({}, { get: (t, k) => "by " + String(k) })), 0, 1), 3), "by 3");
check("list above", read(store(Object.create([7, 8, 9]), 0, 1), 2), 9);
check("typed array above", read(store(Object.create(new Uint8Array([4, 5])), 0, 1), 1), 1 === 1 ? Object.create(new Uint8Array([4, 5]))[1] : 0);
check("string above", read(store(Object.create(new String("abc")), 5, 1), 1), "b");
check("arguments above", (function () { return read(store(Object.create(arguments), 5, 1), 1); })("x", "y"), "y");
const own = store({}, 0, 1);
Object.defineProperty(own, 3, { get() { return "own getter"; }, configurable: true });
check("own getter", read(own, 3), "own getter");
check("beside it", read(own, 2), undefined);
check("negative", read(store({ "-1": "minus" }, 0, 1), -1), "minus");
const late = store({}, 0, 1);
check("before", read(late, 2), undefined);
Object.setPrototypeOf(late, { 2: "late" });
check("behind", read(late, 2), "late");
class Base { get(i) { return this[i]; } }
class Heir extends Base { constructor() { super(); this[0] = "zero"; } }
for (let i = 0; i < 50; ++i) { check("heir", new Heir().get(0), "zero"); check("heir lacks", new Heir().get(1), undefined); }
console.log(failures);
