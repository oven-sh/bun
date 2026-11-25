// A scale weighs what lies a step further on by a number that it keeps in a field, and the sum takes both. Rows with holes, texts, objects and numbers of every kind, and rates that
// change while the row is read, or that are no numbers, answer as they are written.
// STATISTIC: FieldFactorsTakenForNumbers >= 1

class Scale {
  constructor(rate, base) { this.rate = rate; this.base = base; }
  along(row, step) { let sum = this.base; for (let at = 0; at + step < row.length; at++) sum += row[at] + this.rate * row[at + step]; return sum; }
  once(row, at, other) { return row[at] + this.rate * row[other]; }
  twice(rows) { let sum = 0; for (let k = 0; k < rows.length; k++) { const row = rows[k]; sum += row[0] + this.rate * row[1] + this.base * row[2]; } return sum; }
}

// The same, for rates that are no numbers.
class Guess {
  constructor(rate, base) { this.rate = rate; this.base = base; }
  along(row, step) { let sum = this.base; for (let at = 0; at + step < row.length; at++) sum += row[at] + this.rate * row[at + step]; return sum; }
  once(row, at, other) { return row[at] + this.rate * row[other]; }
  twice(rows) { let sum = 0; for (let k = 0; k < rows.length; k++) { const row = rows[k]; sum += row[0] + this.rate * row[1] + this.base * row[2]; } return sum; }
}

const show = value => typeof value === "bigint" ? value + "n" : Object.is(value, -0) ? "-0" : typeof value === "string" ? JSON.stringify(value) : String(value);
const told = ask => { try { return show(ask()); } catch (error) { return error.name; } };
const halves = length => Array.from({ length }, (_, at) => at * 0.5 + 0.25);

const warm = new Scale(1.5, 0.5), cold = new Scale(-2.25, 8);
for (let turn = 0; turn < 60; turn++) { warm.along(halves(40), 3); cold.along(halves(17), 1); warm.once(halves(8), turn & 3, 4 + (turn & 3)); cold.twice([halves(3), halves(3), halves(4)]); }
console.log(warm.along(halves(40), 3), cold.along(halves(17), 1), warm.once(halves(8), 1, 6), cold.twice([halves(3), halves(5)]));

const holed = halves(9); delete holed[4];
const below = halves(6); delete below[2]; Object.setPrototypeOf(below, Object.assign(Object.create(Array.prototype), { 2: 100 }));
const rows = {
  doubles: () => halves(9), whole: () => [1, 2, 3, 4, 5, 6, 7, 8, 9], holed: () => holed.slice(), inherits: () => below, empty: () => [], short: () => [1.5, 2.5],
  greatest: () => [2147483647, -2147483648, 2147483647, 1e308, 1e308, -1e308], zeros: () => [-0, 0, -0, -0], nans: () => [0.5, NaN, 2.5, Infinity, -Infinity, 1.5],
  nothing: () => [1.5, undefined, 2.5, null, 3.5], texts: () => [1.5, "2", 2.5, "x", 3.5], flags: () => [true, 1.5, false, 2.5], bigs: () => [1.5, 2n, 2.5], lists: () => [1.5, [4], 2.5, []],
  floats: () => new Float32Array([0.1, 0.2, 0.3, 0.4, 0.5]), bytes: () => new Uint8Array([1, 200, 3, 250]), words: () => new BigInt64Array(4), likeness: () => ({ length: 4, 0: 1.5, 1: 2.5, 3: 4.5 }),
  asked: () => { const order = []; const row = [1.5, { valueOf() { order.push("a"); return 2; } }, { valueOf() { order.push("b"); return 3; } }, 4.5]; row.order = order; return row; },
};
for (const [name, make] of Object.entries(rows)) {
  const asked = [1, 2, 3].map(step => told(() => warm.along(make(), step)));
  const row = make();
  console.log(name, asked.join(" "), told(() => cold.once(row, 0, 1)), told(() => cold.once(row, 1, 2)), told(() => cold.once(row, 3, -1)), told(() => warm.twice([row, halves(3)])), (row.order || []).join(""));
}

for (const rate of [3, -0, NaN, Infinity, 2147483647, "2", "", "x", null, undefined, true, 2n, [5], { valueOf: () => 1.5 }, Symbol.iterator]) {
  const scale = new Guess(rate, 1);
  console.log(show(typeof rate === "symbol" ? "symbol" : typeof rate === "object" && rate ? "object" : rate), told(() => scale.along(halves(7), 2)), told(() => scale.once(holed, 3, 4)), told(() => scale.twice([halves(3), [1, 2, 3]])), told(() => scale.along([], 1)));
}

// What is read of the row lays another number into the field of numbers.
const moving = new Scale(2, 0);
console.log(told(() => moving.along([1, 2, { valueOf() { moving.rate += 1; return 10; } }, 4, { valueOf() { moving.rate = -0.5; return 20; } }, 6, 7], 1)), moving.rate);

// What is read of the row lays another number, or a text, into the field.
const turns = new Guess(2, 0);
const moved = [1, 2, { valueOf() { turns.rate += 1; return 10; } }, 4, { valueOf() { turns.rate = "3"; return 20; } }, 6, 7];
console.log(told(() => turns.along(moved, 1)), show(turns.rate));
let reads = 0;
const heir = new Guess(1, 0); Object.defineProperty(heir, "rate", { get() { reads++; return reads / 2; } });
console.log(told(() => heir.along(halves(6), 1)), reads, told(() => heir.once(holed, 4, 4)), reads);
class Kept extends Guess { constructor() { super(1, 1); delete this.rate; } }
Object.defineProperty(Kept.prototype, "rate", { value: 4, writable: true });
console.log(told(() => new Kept().along(halves(5), 1)), told(() => Guess.prototype.along.call({ rate: 2, base: "from " }, halves(3), 1)), told(() => Guess.prototype.once.call(undefined, halves(3), 0, 1)));
