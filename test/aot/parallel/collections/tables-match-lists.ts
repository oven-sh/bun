// Maps and sets of every size, key and value kind, against a model made of lists: every stub of a table and its exits.
class ModelMap {
    keys: any[] = []; values: any[] = [];
    index(key: any) { for (let i = 0; i < this.keys.length; i++) { const k = this.keys[i]; if (k === key || (k !== k && key !== key)) return i; } return -1; }
    get(key: any) { const i = this.index(key); return i < 0 ? undefined : this.values[i]; }
    has(key: any) { return this.index(key) >= 0; }
    set(key: any, value: any) { const i = this.index(key); if (i < 0) { this.keys.push(key); this.values.push(value); } else this.values[i] = value; }
    delete(key: any) { const i = this.index(key); if (i < 0) return false; this.keys.splice(i, 1); this.values.splice(i, 1); return true; }
}
let seed = 12345;
function random(limit: number): number { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return (seed >> 8) % limit; }
const objects: object[] = []; for (let i = 0; i < 700; i++) objects.push({ id: i });
const long = "a long key that no table of short keys holds in place, number ";
function keyOf(kind: number, n: number): any {
    switch (kind) {
        case 0: return "k" + n;
        case 1: return n;
        case 2: return objects[n % 700];
        case 3: return n + 0.5;
        case 4: return long + n;
        case 5: return ("part" + n + "tail").substring(4, 4 + ("" + n).length + 2);
        case 6: return n % 3 === 0 ? undefined : n % 3 === 1 ? null : n % 2 === 0;
        case 7: return BigInt(n);
        case 8: return Symbol.for("s" + n);
        case 9: return -n;
        case 10: return n === 1 ? NaN : n === 2 ? -0 : n * 4294967296;
        default: return "Ж" + n;
    }
}
function valueOf(kind: number, n: number): any {
    switch (kind) {
        case 0: return objects[n % 700];
        case 1: return n;
        case 2: return "v" + n;
        case 3: return undefined;
        case 4: return n / 3;
        case 5: return null;
        case 6: return n % 2 === 0;
        case 7: return [n];
        default: return n % 2 ? objects[n % 700] : n;
    }
}
let wrong = 0, sum = 0, count = 0;
function check(a: any, b: any, what: string) { count++; if (!(a === b || (a !== a && b !== b))) { wrong++; if (wrong < 20) console.log("WRONG", what, String(a), String(b)); } }
const sizes = [1, 3, 8, 9, 16, 40, 254, 256, 300];
function run(keyKinds: number[], valueKinds: number[], size: number, steps: number) {
    const map = new Map<any, any>(); const model = new ModelMap(); const set = new Set<any>();
    for (let step = 0; step < steps; step++) {
        const kind = keyKinds[random(keyKinds.length)]; const n = random(size); const key = keyOf(kind, n);
        const what = "size " + size + " step " + step + " kind " + kind;
        switch (random(8)) {
            case 0: case 1: case 2: { const value = valueOf(valueKinds[random(valueKinds.length)], random(1000)); check(map.set(key, value), map, what + " set"); model.set(key, value); check(set.add(key), set, what + " add"); break; }
            case 3: { check(map.delete(key), model.delete(key), what + " delete"); set.delete(key); break; }
            case 4: check(map.has(key), model.has(key), what + " has"); check(set.has(key), model.has(key), what + " set has"); break;
            default: check(map.get(key), model.get(key), what + " get");
        }
        check(map.size, model.keys.length, what + " size");
    }
    let i = 0; for (const [key, value] of map) { check(key, model.keys[i], "order"); check(value, model.values[i], "value in order"); i++; }
    i = 0; for (const key of set) { check(key, model.keys[i], "order of the set"); i++; }
    sum = (sum * 31 + model.keys.length) | 0;
}
for (const size of sizes) {
    for (let kind = 0; kind < 12; kind++) for (let value = 0; value < 9; value += 2) run([kind], [value], size, 30);
    run([0, 4, 5], [0], size, 300); run([0, 1], [1], size, 300); run([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], [0, 1, 2, 3, 4, 5, 6, 7, 8], size, 400); run([0], [0, 3], size, 400); run([0, 2], [8], size, 400);
}
// Strings alone, typed: the form for strings.
function words(size: number): number {
    const map = new Map<string, object>(); const counts = new Map<string, number>(); const seen = new Set<string>(); let total = 0;
    for (let round = 0; round < 4; round++) for (let i = 0; i < size; i++) {
        const word = "w" + ((i * 7919) % size); const known = map.get(word);
        if (known === undefined) map.set(word, objects[i % 700]); else total += (known as any).id;
        counts.set(word, (counts.get(word) || 0) + 1); if (!seen.has(word)) { seen.add(word); total++; } if (map.has("absent" + i)) total += 1e9; if (map.get("other" + i)) total += 1e9;
    }
    for (const [word, n] of counts) total = (total * 33 + n + word.length) | 0;
    return total;
}
const totals: number[] = []; for (const size of [1, 2, 7, 8, 9, 60, 127, 128, 254, 255, 256, 1000, 3000]) totals.push(words(size));
console.log(wrong, count, sum, totals.join(" "));
