const enum Cents { Zero = 0, One = 1, FortyTwo = 42, Eighty = 80 }
class Coin { cents: Cents; constructor(cents: Cents) { this.cents = cents; } }
const table = [10, 20, 30, 40, 50, 60, 70, 80];
const bytes = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
const text = "abcdefgh";
const list: Coin[] = JSON.parse('[]');
for (const n of [0, 1, 2, 3, 42, 80, 7, 255]) list.push(new Coin(n));
let s = 0;
for (let round = 0; round < 3; round++) {
  for (let i = 0; i < list.length; i++) { const c: any = list[i].cents; { const e = table[c]; s += e === undefined ? 1 : e; } }
}
console.log(s);
