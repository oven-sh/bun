function walk(limit: number, from: number, to: number, seen: number[]): string {
  let sum = 0, turns = 0;
  for (let i = from; i <= to; i++) {
    for (let j = i * 2; j <= limit; j += i) {
      seen[j & 7] = j;
      sum = (sum + (j % 1000003)) % 1000000007;
      turns++;
    }
  }
  return sum + " " + turns + " " + seen.join(",");
}
function down(limit: number, from: number, step: number, seen: number[]): string {
  let turns = 0, last = 0;
  for (let i = 1; i <= 3; i++) {
    const by = step * i;
    for (let j = from; j < limit && turns < 40; j += by) { seen[j & 3] = j; last = j; turns++; }
  }
  return turns + " " + last + " " + seen.join(",");
}
const eight = () => [0, 0, 0, 0, 0, 0, 0, 0];
console.log(walk(100, 2, 10, eight()));
console.log(walk(100.5, 2, 10, eight()));
console.log(walk(2147483647, 500000000, 500000003, eight()));
console.log(walk(2147483648, 500000000, 500000003, eight()));
console.log(walk(6000000000, 700000000, 700000004, eight()));
console.log(walk(6000000000.75, 1073741823, 1073741825, eight()));
console.log(walk(9007199254740000, 2147483646, 2147483647, eight()).length > 0);
console.log(walk(NaN, 2, 10, eight()));
console.log(walk(-5, 2, 10, eight()));
console.log(walk(3, 2, 10, eight()));
console.log(down(50, 0, 7, [0, 0, 0, 0]));
console.log(down(50, -2147483648, 1000000000, [0, 0, 0, 0]));
console.log(down(5000000000, 2147483000, 300, [0, 0, 0, 0]));
console.log(down(10, 5, -3, [0, 0, 0, 0]));
console.log(down(10, 5, 0, [0, 0, 0, 0]));
