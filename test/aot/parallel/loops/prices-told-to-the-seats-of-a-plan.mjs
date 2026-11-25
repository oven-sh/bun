// The seats of a hall's plan, which is a list of rows, are told a price by a method that loops call with what their caller was handed: a number by the comment, and whatever comes by the run. Rows of numbers of every kind, of texts, with holes, frozen ones, views, rows that are no lists or are missing, a price that is no number.
export class Plan extends Array {
  constructor(rows, seats) { super(); this.told = 0; this.seats = seats; while (this.length < rows) this.push(new Array(seats)); this.rows = rows; }
  tell(row, seat, price) { this[row][seat] = price; }
  of(row, seat) { return this[row][seat]; }
  /** @param {number} price */
  under(price) { for (let row = 1; row < this.rows; row++) for (let seat = 0; seat <= row; seat++) { this.tell(row, seat, price); this.told++; } return this.told; }
  /** @param {number} price */
  front(price) { for (let seat = 0; seat < this.seats; seat++) this.tell(0, seat, price); return price - 1; }
  /** @param {number} seat @param {number} price */
  gangway(seat, price) { for (let row = 0; row < this.rows; row++) this.tell(row, seat, price); return price * 2; }
  sum() { let sum = 0; for (let row = this.rows - 1; row >= 0; row--) for (let seat = this.seats - 1; seat >= 0; seat--) sum = sum * 0.5 + this.of(row, seat); return sum; }
}
globalThis.town = { Plan };
const one = value => Object.is(value, -0) ? "-0" : typeof value === "bigint" ? value + "n" : typeof value === "object" && value !== null ? "o" : String(value);
const show = plan => Array.from(plan, row => row === null || typeof row !== "object" ? one(row) : Array.from({ length: Math.min(row.length, 8) }, (_, seat) => seat in row ? one(row[seat]) : "_").join()).join(" / ");
let sum = 0;
for (let round = 0; round < 200; round++) {
  const plan = new town.Plan(5, 6);
  sum += plan.front(round / 3) + plan.under(round * 0.25) + plan.gangway(round % 6, round / 4);
  for (let row = 0; row < 5; row++) for (let seat = 0; seat < 6; seat++) if (plan.of(row, seat) === undefined) plan.tell(row, seat, 1);
  if (round & 1) plan.gangway(2, round);
  sum += plan.sum();
}
console.log(sum);
const hidden = globalThis[JSON.parse('"Reflect"')];
let asked = 0;
const prices = { whole: 7, fraction: 2.5, zero: -0, nan: NaN, large: 2 ** 31, text: "9", nothing: undefined, none: null, truth: true, big: 5n, object: { valueOf() { asked++; return 3; } } };
const rows = {
  holes: () => new Array(6), whole: () => [1, 2, 3, 4, 5, 6], fractions: () => [0.5, 1.5, 2.5, 3.5, 4.5, 5.5], texts: () => ["a", "b", "c", "d", "e", "f"], short: () => [1], frozen: () => Object.freeze([1, 2, 3, 4, 5, 6]),
  doubles: () => new Float64Array(6), words: () => new Int32Array(6), bytes: () => new Uint8ClampedArray(6), bigs: () => new BigInt64Array(6), object: () => ({ length: 3 }), missing: () => undefined, number: () => 4, text: () => "seats",
  setter: () => Object.defineProperty([1, 2, 3], 1, { set(price) { asked += typeof price === "number" ? 10 : 100; }, configurable: true }), proxy: () => new Proxy([1, 2], { set(target, seat, price) { asked++; target[seat] = price; return true; } }),
};
for (const kind of Object.keys(rows)) {
  const line = [];
  for (const price of Object.keys(prices)) {
    const plan = new town.Plan(4, 5);
    for (let row = 0; row < 4; row++) plan[row] = row & 1 ? rows[kind]() : [row, 0.5, , 2, 3];
    asked = 0;
    let told = "";
    for (const way of ["front", "under"]) try { told += one(hidden.apply(town.Plan.prototype[way], plan, [prices[price]])) + " "; } catch (error) { told += error.constructor.name + " "; }
    try { told += one(hidden.apply(town.Plan.prototype.gangway, plan, [1, prices[price]])); } catch (error) { told += error.constructor.name; }
    line.push(price + ": " + told + " " + asked + " " + show(plan));
  }
  console.log(kind, line.join(" | "));
}
