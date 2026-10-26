function twice(read: () => number, depth: number): number {
  if (depth > 0) return twice(read, depth - 1);
  return read() + read();
}

function around(value: number): number {
  return twice(() => value + 1, 2);
}

const turns = process.argv.length > 99 ? 6 : 5;
const seen: number[] = [];
for (let turn = 0; turn < turns; turn++) seen.push(around(turn));
console.log(seen.join(" "));
