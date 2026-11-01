// An object used as a table under keys of 2,500 characters, 3,000 of them: reads, `in`, stores and deletes under flat strings and under strings that were just joined.
// Each access asked every name of the table for its length: 12,000 reads took 1.2 s.
const table = Object.create(null);
const copyOf = text => JSON.parse(JSON.stringify(text));
const tail = copyOf("x".repeat(2500));
const wideTail = copyOf("Ж".repeat(2500));
const heads = [];
for (let i = 0; i < 3000; i++) {
  const head = copyOf(String(i).padStart(8, "0"));
  heads.push(head);
  table[head + (i % 3 ? tail : wideTail)] = i;
}
const tailOf = i => (i % 3 ? tail : wideTail);
const flat = heads.map((head, i) => copyOf(head + tailOf(i)));
let sum = 0, has = 0, absent = 0;
for (let turn = 0; turn < 2; turn++) {
  for (let i = 0; i < heads.length; i++) {
    sum += table[flat[i]] + table[heads[i] + tailOf(i)];
    if (flat[i] in table) has++;
    if (heads[i] + tailOf(i) in table) has++;
    if (Object.hasOwn(table, heads[i] + tailOf(i))) has++;
    if ("y" + heads[i] + tailOf(i) in table) absent++;
    if (table[heads[i] + "y" + tailOf(i)] !== undefined) absent++;
    if (table[copyOf("y" + flat[i].slice(1))] !== undefined) absent++;
  }
}
console.log(sum, has, absent);
for (let i = 0; i < heads.length; i += 2) table[heads[i] + tailOf(i)] = -i;
for (let i = 1; i < heads.length; i += 4) delete table[heads[i] + tailOf(i)];
for (let i = 3; i < heads.length; i += 4) delete table[flat[i]];
let left = 0, total = 0;
for (let i = 0; i < heads.length; i++) {
  if (flat[i] in table) { left++; total += table[heads[i] + tailOf(i)]; }
}
console.log(left, total, Object.keys(table).length);
const child = Object.create(table);
child[heads[0] + "z" + tail] = "own";
console.log(child[heads[0] + tailOf(0)], child[flat[2]], child[heads[0] + "z" + tail], heads[1] + tailOf(1) in child, Object.hasOwn(child, flat[2]), Object.keys(child).length);
