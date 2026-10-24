// Many shapes, made one after the other, asked for the same names, and one shape asked for many names: whatever remembers a shape and a key has to tell the pairs apart.
function read(object: any, key: any): any { return object[key]; }
function isIn(object: any, key: any): boolean { return key in object; }
function store(object: any, key: any, value: any): void { object[key] = value; }
const names: string[] = [];
for (let i = 0; i < 48; i++) names.push("n" + i);
const symbols = [Symbol("s0"), Symbol("s1"), Symbol("s2")];
let wrong = 0;
let asked = 0;
function expect(what: string, got: any, wanted: any): void {
    asked++;
    if (got !== wanted && wrong++ < 20) console.log("WRONG " + what + ": " + String(got) + ", not " + String(wanted));
}
// Shape s has the names s % 7, s % 7 + step, .. in an order of its own, so that the same name lies at another place in each.
function make(s: number): any {
    const object: any = {};
    object["shape" + s] = s;
    const step = 1 + s % 5;
    for (let i = s % 7, place = 0; i < names.length; i += step, place++) object[names[(i + s) % names.length]] = s * 100 + place;
    if (s % 3 === 0) object[symbols[s % symbols.length]] = -s;
    return object;
}
function expected(s: number): Map<any, number> {
    const map = new Map<any, number>();
    const step = 1 + s % 5;
    for (let i = s % 7, place = 0; i < names.length; i += step, place++) map.set(names[(i + s) % names.length], s * 100 + place);
    if (s % 3 === 0) map.set(symbols[s % symbols.length], -s);
    return map;
}
const count = 400;
const objects: any[] = [];
const maps: Map<any, number>[] = [];
for (let s = 0; s < count; s++) { objects.push(make(s)); maps.push(expected(s)); }
const keys: any[] = [...names, ...symbols];
for (let round = 0; round < 3; round++) {
    // By shape, then by key; and by key, then by shape.
    for (let s = 0; s < count; s++) for (const key of keys) { expect("read", read(objects[s], key), maps[s].get(key)); expect("in", isIn(objects[s], key), maps[s].has(key)); }
    for (const key of keys) for (let s = 0; s < count; s++) { expect("read by key", read(objects[s], key), maps[s].get(key)); expect("in by key", isIn(objects[s], key), maps[s].has(key)); }
    // Replace what is there, add what is not, on a second object of each shape.
    for (let s = 0; s < count; s += 3) {
        const twin = make(s);
        const map = expected(s);
        for (const key of keys) { store(twin, key, round); map.set(key, round); }
        for (const key of keys) expect("stored", read(twin, key), map.get(key));
        expect("names of the twin", Reflect.ownKeys(twin).length, keys.length + 1);
        for (const key of keys) expect("untouched", read(objects[s], key), maps[s].get(key));
    }
}
console.log("asked " + asked + ", wrong " + wrong);
