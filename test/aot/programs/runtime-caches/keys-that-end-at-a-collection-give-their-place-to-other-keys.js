// Strings made at run time serve as keys and are dropped. After a collection other strings, with other texts, are made and serve as keys of the same objects.
const collect = typeof Bun !== "undefined" ? () => Bun.gc(true) : () => {};
const o = {}; const bare = Object.create(null);
for (let i = 0; i < 64; i++) { o["n" + i] = i; bare["n" + i] = -i; }
let sum = 0;
function use(keys, turn) {
    for (let r = 0; r < 4; r++) for (let i = 0; i < keys.length; i++) {
        const k = keys[i];
        sum = (sum * 7 + o[k] + bare[k] * 3 + (k in o ? 1 : 0) + (Object.hasOwn(bare, k) ? 2 : 0)) | 0;
        o[k] = o[k] + 1; bare[k] -= turn;
    }
}
for (let turn = 0; turn < 60; turn++) {
    let keys = [];
    const all = []; for (let i = 0; i < 64; i++) all.push("n" + ((i * 5 + turn) & 63));
    const joined = all.join(",");
    keys = turn & 1 ? joined.split(",") : all.map((name, i) => ("#" + name).slice(1));
    use(keys, turn);
    keys = null;
    if (turn % 3 === 0) collect();
    const junk = []; for (let i = 0; i < 2000; i++) junk.push("j" + i + turn);
    sum = (sum + junk.length) | 0;
}
console.log(sum, JSON.stringify(o).length, Object.keys(bare).length, o.n0, o.n63, bare.n1, bare.n62);
// Objects end too, and others of other shapes are made where they were.
function shapes(turn) {
    const list = [];
    for (let i = 0; i < 300; i++) { const x = {}; x["a" + (turn + i) % 7] = i; x["b" + (turn * 3 + i) % 5] = -i; x.c = turn; list.push(x); }
    return list;
}
const names = ["a0", "a1", "a2", "a3", "a4", "a5", "a6", "b0", "b1", "b2", "b3", "b4", "c"].map(n => (n + "!").slice(0, -1));
let total = 0;
for (let turn = 0; turn < 80; turn++) {
    const list = shapes(turn);
    for (const x of list) for (const k of names) { const v = x[k]; if (v !== undefined) { total = (total * 3 + v) | 0; x[k] = v + 1; total = (total + x[k]) | 0; } else if (k in x) total++; }
    if (turn % 5 === 0) collect();
}
console.log(total);
