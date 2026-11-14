// Callbacks that read the properties of elements of which nothing is known: getters, proxies and throws are seen once and in order.
const seen = [];
const say = v => typeof v === "function" ? "function" : typeof v === "string" ? JSON.stringify(v) : Object.is(v, -0) ? "-0" : Array.isArray(v) ? "[" + v.map(say).join() + "]" : typeof v === "object" && v ? "{" + Object.keys(v).map(k => k + "=" + say(v[k])).join() + "}" : String(v);
class Told { constructor(id) { this.id = id; } get name() { seen.push("name" + this.id); return "t" + this.id; } get age() { seen.push("age" + this.id); return this.id * 3; } }
class User { constructor(id) { this.id = id; this.name = "u" + id; this.age = id / 2; } }
function records(list) { return list.map(u => ({ id: u.id, name: u.name })); }
function others(list) { return list.map(u => ({ key: u.id, label: u.name })); }
function pairs(list) { return list.map(u => [u.id, u.age]); }
function parts(list) { return list.map(({ id, name }) => ({ name, id })); }
function strings(list) { return list.map(u => u.name + ":" + u.id); }
function sums(list) { return list.map(u => u.id + u.age); }
function names(list) { return list.filter(u => u.age > 2).map(u => u.name); }
function total(list) { return list.reduce((sum, u) => sum + u.age, 0); }
function most(list) { return list.reduce((most, u) => u.age > most ? u.age : most, -1); }
function some(list) { return list.some(u => u.id === 3); }
function found(list) { return list.find(u => u.name === "n2"); }
function where(list) { return list.findIndex(u => u.age * 2 > 7); }
function inner(list) { return list.map(u => u.inner.name); }
const json = n => JSON.parse(JSON.stringify(Array.from({ length: n }, (_, i) => ({ id: i, name: "n" + i, age: i * 2, inner: { name: "m" + i } }))));
function lists() {
    const getter = json(4);
    Object.defineProperty(getter[2], "age", { get() { seen.push("get"); return 5; }, enumerable: true });
    const proxied = json(3);
    proxied[1] = new Proxy(proxied[1], { get(target, key) { seen.push(String(key)); return target[key]; } });
    const missing = json(4);
    delete missing[1].age;
    delete missing[3].name;
    return [[], json(1), json(4), json(40), [new User(1), new User(3)], [{ id: 3, name: "n2", age: 1 }, { age: 8, id: 1 }], [new Told(1), new Told(3)], getter, proxied, missing, json(5).map((u, i) => i % 2 ? u : { age: u.age, id: u.id, name: u.name }),
        [Object.create({ name: "above", age: 4 })], [null], [{ id: 1 }, undefined], [{ id: 3, name: 7, age: "9" }, , { id: "3" }], ["n2", 5, true], [[1], [2]], [{ id: { valueOf() { seen.push("valueOf"); return 4; } }, name: { toString() { seen.push("toString"); return "s"; } }, age: [2] }], [{ id: NaN, name: "", age: -0 }, { id: 3n, name: Symbol.iterator, age: undefined }]];
}
function once(list) {
    let said = "";
    for (let f = 0; f < 13; f++) {
        let result;
        try {
            switch (f) {
            case 0: result = records(list); break;
            case 1: result = others(list); break;
            case 2: result = pairs(list); break;
            case 3: result = parts(list); break;
            case 4: result = strings(list); break;
            case 5: result = sums(list); break;
            case 6: result = names(list); break;
            case 7: result = total(list); break;
            case 8: result = most(list); break;
            case 9: result = some(list); break;
            case 10: result = found(list); break;
            case 11: result = where(list); break;
            case 12: result = inner(list); break;
            }
            said += say(result) + " ";
        } catch (e) { said += e.constructor.name + " "; }
        said += seen.join() + " ";
        seen.length = 0;
    }
    return said;
}
for (let turn = 0; turn < 3; turn++) for (const [k, list] of lists().entries()) console.log(k, once(list));
