const enum Cents { Zero = 0, One = 1, FortyTwo = 42, Eighty = 80 }
class Coin { cents: Cents; constructor(cents: Cents) { this.cents = cents; } }
const table = [10, 20, 30, 40, 50, 60, 70, 80];
const bytes = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
const text = "abcdefgh";
const list: Coin[] = JSON.parse('[{"cents":1.5},{"cents":-0.25},{"cents":42.0},{"cents":1e300}]');
for (const n of [2147483647, -2147483648, 2147483646, -2147483647, 0, -1, 1, 1073741824]) list.push(new Coin(n));
function one(coin: Coin, i: number, s: number): number { const c = coin.cents; if (c >= 0) s += 1; else s += 2; return s; }
let sum = 0;
for (let round = 0; round < 3; round++) { for (let i = 0; i < list.length; i++) sum = one(list[i], i, sum); }
console.log(sum);
