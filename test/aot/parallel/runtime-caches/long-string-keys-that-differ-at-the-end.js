// A table under long keys of one length that differ only in their last characters: reads, `in`, stores and deletes under flat strings and under strings that were just joined.
// Each access compared the key with every name of the table, to the end: 2,000 names of 40,000 characters took 13 s where plain Bun takes 21 ms.
const copyOf = text => JSON.parse(JSON.stringify(text));
for (const [names, length, unit] of [[100, 2500, "x"], [600, 10000, "x"], [600, 10000, "Ж"], [2000, 40000, "x"]]) {
  const table = Object.create(null);
  const head = copyOf(unit.repeat(length - 8));
  const tails = [];
  for (let i = 0; i < names; i++) {
    tails.push(copyOf(String(i).padStart(8, "0")));
    table[head + tails[i]] = i;
  }
  const flat = tails.map(tail => copyOf(head + tail));
  let sum = 0, has = 0, absent = 0;
  for (let i = 0; i < names; i++) {
    sum += table[flat[i]] + table[head + tails[i]];
    if (flat[i] in table) has++;
    if (head + tails[i] in table) has++;
    if (Object.hasOwn(table, head + tails[i])) has++;
    if (head + "9" + tails[i].slice(1) in table) absent++;
    if (table[head + tails[i].slice(1) + "y"] !== undefined) absent++;
  }
  for (let i = 0; i < names; i += 2) table[head + tails[i]] = -i;
  for (let i = 1; i < names; i += 4) delete table[head + tails[i]];
  for (let i = 3; i < names; i += 4) delete table[flat[i]];
  let left = 0, total = 0;
  for (let i = 0; i < names; i++) {
    if (flat[i] in table) {
      left++;
      total += table[head + tails[i]];
    }
  }
  console.log(names, length, sum, has, absent, left, total, Object.keys(table).length);
}
