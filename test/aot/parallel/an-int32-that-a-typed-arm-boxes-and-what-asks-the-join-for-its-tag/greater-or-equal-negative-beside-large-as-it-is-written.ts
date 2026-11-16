const enum Cents { Zero = 0, One = 1, FortyTwo = 42, Eighty = 80 }
class Coin { cents: Cents; constructor(cents: Cents) { this.cents = cents; } }
const table = [10, 20, 30, 40, 50, 60, 70, 80];
const bytes = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
const text = "abcdefgh";
const list: Coin[] = JSON.parse('[{"cents":2147483648},{"cents":-2147483649},{"cents":4294967338}]');
for (const n of [-1, -2, -42, -80, -255, -65536, 0, 5]) list.push(new Coin(n));
let s = 0;
for (let round = 0; round < 3; round++) {
  for (let i = 0; i < list.length; i++) { const c = list[i].cents; if (c >= 0) s += 1; else s += 2; }
}
console.log(s);
