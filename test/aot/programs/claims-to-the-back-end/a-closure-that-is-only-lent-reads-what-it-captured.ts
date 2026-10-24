function twice(read: () => number, depth: number): number {
  if (depth > 0) return twice(read, depth - 1);
  return read() + read();
}

function around(value: number): number {
  return twice(() => value + 1, 2);
}

const seen: number[] = [];
for (let turn = 0; turn < 5; turn++) seen.push(around(turn));
console.log(seen.join(" "));
