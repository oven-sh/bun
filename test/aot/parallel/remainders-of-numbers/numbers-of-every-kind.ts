const kinds = [0, -0, 1, -1, 2, 3, -3, 0.5, -0.5, 1.5, 5, 7, 255, 4294967295, 4294967296, 2147483648, -2147483648, 9007199254740991, 9007199254740992, -9007199254740992, 2 ** 62, 2 ** 63, -(2 ** 63), 2 ** 64, 1e300, 5e-324, 2.220446049250313e-16, Infinity, -Infinity, NaN];
const show = (value: number) => (Object.is(value, -0) ? "-0" : String(value));
function unsigned(seed: number): number {
  return Math.imul(seed, 2654435761) >>> 0;
}
function below(bound: number): number {
  const threshold = (4294967296 - bound) % bound;
  for (let i = 0; i < 3; i++) {
    const value = unsigned(i + bound);
    if (value >= threshold) return value % bound;
  }
  return -1;
}
function byte(text: string, divisor: number): number {
  return text.charCodeAt(0) % divisor;
}
function length(list: number[], divisor: number): number {
  return list.length % divisor;
}
function bits(value: number, divisor: number): number {
  return (value >>> 0) % divisor;
}
function floor(value: number, divisor: number): number {
  return Math.floor(Math.abs(value)) % divisor;
}
function round(value: number, divisor: number): number {
  return Math.round(value) % divisor;
}
let sum = "";
for (const divisor of kinds) {
  const row: string[] = [];
  for (const dividend of kinds) row.push(show(dividend % divisor), show(bits(dividend, divisor)), show(floor(dividend, divisor)), show(round(dividend, divisor)));
  console.log(show(divisor), row.join(" "), show(below(divisor)), show(byte("z", divisor)), show(length([1, 2, 3], divisor)), show(length([], divisor)));
}
for (let i = 1; i < 2000; i++) sum = show(Number(sum || 0) + below(i + 0.5 * (i % 2)) + (unsigned(i) % i) + (i * 1.5) % (i % 7));
console.log(sum);
class Table {
  capacity: number;
  constructor(capacity: number) {
    this.capacity = capacity;
  }
  place(hash: number): number {
    return (hash >>> 0) % this.capacity;
  }
}
const tables = [new Table(16), new Table(17), new Table(2.5), new Table(0), new Table(-7), new Table(NaN), new Table(2 ** 33)];
for (const table of tables) {
  let total = 0;
  for (let i = 0; i < 500; i++) total += table.place(Math.imul(i, 0x9e3779b1));
  console.log(table.capacity, show(total), show(table.place(0)), show(table.place(-1)));
}
let state = 12345;
let generated = 0;
for (let i = 0; i < 5000; i++) {
  state = (state * 16807) % 2147483647;
  generated = (generated + (state % (i + 1.25))) % 65521.5;
}
console.log(state, generated);
