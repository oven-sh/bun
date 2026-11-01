// Closures that are only lent ahead of an await read what they captured.
function twice(read, depth) {
  if (depth > 0) return twice(read, depth - 1);
  return read() + read();
}
async function around(value, depth) {
  const sum =
    twice(() => value + 1, 2) + twice(() => value + 2, 2) + twice(() => value + depth, 2) + twice(() => depth + 4, 2);
  await null;
  return sum;
}
const turns = process.argv.length > 99 ? 6 : 5;
const seen = [];
for (let turn = 0; turn < turns; turn++) seen.push(await around(turn, turns));
console.log(seen.join(" "));
