import { basename } from "node:path";

class Account {
  #balance = 0;
  deposit(amount: number): void {
    this.#balance += amount;
  }
  get balance(): number {
    return this.#balance;
  }
}

function fill(given: number[], rounds: number): number {
  const accounts = [new Account(), new Account(), new Account()];
  for (let i = 0; i < rounds; i++) {
    for (let k = 0; k < given.length; k++) accounts[k % 3].deposit((given[k] & 63) + (given[k] | 1));
  }
  let total = 0;
  for (const account of accounts) total += account.balance;
  return total;
}

const integers = basename("1 2 300 70000").split(" ").map(word => parseInt(word, 10));
const fractions = basename("1.5 -2.25 4294967297 x").split(" ").map(Number);
const holes = basename("5 6 7 8").split(" ").map(Number);
delete holes[1];
const mixed: number[] = integers.slice();
mixed.push(0.5, NaN, Infinity);
for (const given of [integers, fractions, holes, mixed, []]) console.log(fill(given, 9));
