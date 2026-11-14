// A helper that is called under a condition stores an optional field into a literal of the file.
const input: any = [(...values: any[]) => values[0]][process.argv.length > 9 ? 1 : 0];
type Parcel = { weight: number; price?: number };
function price(parcel: Parcel, amount: number): void {
  parcel.price = amount;
}

const parcel: Parcel = { weight: +input };
if (input) price(parcel, +input);
(globalThis as any).answer = parcel.price;
console.log(Object.keys(parcel).join());
const other: Parcel = { weight: 2 };
if (!input) price(other, 3);
console.log(Object.keys(other).join(), Object.keys({ ...other, ...parcel }).join());
let found = 0;
for (let k = 0; k < 20; k++) { const o = { a: 1, b: 2, c: 3 } as any; delete o.b; found += Object.keys(o).length; }
console.log(found);
export {};
