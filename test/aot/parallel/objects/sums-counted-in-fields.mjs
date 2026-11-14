// STATISTIC: UnrolledLoopsWithSlotStores >= 3
// A loop adds to one field and steps another. The step of a field that holds doubles takes no guard behind the store of the sum.
class Account {
    #sum = 0; #n = 0; #top = -Infinity;
    constructor(values) { for (const value of values) { this.#sum += value; this.#n++; this.#top = Math.max(this.#top, value); } }
    get total() { return this.#sum / this.#n + this.#top; }
    get text() { return `${this.#sum} ${this.#n} ${this.#top}`; }
}
class Tally {
    #sum = 0; #n;
    constructor(n) { this.#n = n; }
    add(values) { for (const value of values) { this.#sum += value; this.#n++; } return this; }
    remove(values) { for (const value of values) { this.#sum -= value; this.#n--; } return this; }
    get text() { return `${this.#sum} ${this.#n} ${Object.is(this.#n, -0)}`; }
}
const integers = [], doubles = [], mixed = [], holes = [];
for (let i = 0; i < 1000; i++) { integers.push(i % 2 ? -i : i + 3); doubles.push(i * 0.5 - 100.25); mixed.push(i % 7 ? i : "x" + i); holes[i + (i % 5 === 0)] = i; }
let total = 0;
for (let round = 0; round < 50; round++) {
    const account = new Account(round % 2 ? integers : doubles);
    total += account.total;
    if (round < 2) console.log(account.text);
}
console.log(total, new Account([1, 2, 3]).text, new Account([]).text, new Account([NaN, 1]).text, new Account([2 ** 31, 2 ** 53, -(2 ** 60)]).text);
console.log(new Account(mixed).text.length, new Account(holes).text);
for (const start of [0, -3, 2 ** 31 - 500, -(2 ** 31) + 400, 2 ** 53 - 10, 0.5, -0, "7", 2 ** 32])
    console.log(new Tally(start).add(integers).text, new Tally(start).remove(integers).text, new Tally(start).add(doubles).remove(integers).text);
const thrown = new Tally(5);
try { thrown.add({ *[Symbol.iterator]() { yield 1; yield 2; throw new Error("ended"); } }); } catch (error) { console.log(error.message, thrown.text); }
