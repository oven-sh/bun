function wrapped(value: number, size: number): number {
  return ((value % size) + size) % size;
}
const out: number[] = [];
for (let value = -4; value <= 4; value++) out.push(wrapped(value, 3));
console.log(out.join(), -7 % 3, Object.is(-6 % 3, -0));
