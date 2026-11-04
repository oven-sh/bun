// the same function makes keys for several tables, for a plain object and for a text that is printed; the tables grow past their first rooms, lose keys and get them again
function keyOf(a, b) { return a + ":" + b; }
const tables = [new Map(), new Map(), new Set()];
const bag = Object.create(null);
let printed = "";
for (let turn = 0; turn < 3; turn++) {
    for (let i = 0; i < 400; i++) {
        const k = keyOf(i % 97, (i * 7) % 31);
        tables[0].set(k, (tables[0].get(k) || 0) + 1);
        if (!tables[1].has(keyOf(i, turn))) tables[1].set(keyOf(i, turn), i);
        tables[2].add(keyOf(i & 15, "x"));
        bag[keyOf("b", i & 7)] = i;
        if (i % 131 === 0) printed += keyOf(i, turn) + ";";
        if (i % 5 === 0) tables[0].delete(keyOf((i + 1) % 97, ((i + 1) * 7) % 31));
    }
}
let sum = 0;
tables[0].forEach((v, k) => { sum += v * k.length; });
console.log(tables[0].size, tables[1].size, tables[2].size, Object.keys(bag).join(), printed, sum);
console.log(tables[1].get("399:2"), tables[1].get(keyOf(399, 2)), tables[2].has("15:x"), tables[2].has(keyOf(16, "x")));
