let kept: number[] = [];
function storesInto(...values: number[]): number { let s = 0; for (let i = 0; i < values.length; i++) { values[i] = values[i] * 2; s += values[i]; } return s + values[0]; }
function grows(...values: number[]): number { let s = 0; for (let i = 0; i < values.length; i++) { if (values.length < 5) values.push(i); s += values[i]; } return s; }
function shrinks(...values: number[]): number { let s = 0; for (let i = 0; i < values.length; i++) { s += values[i]; values.length = values.length - 1; } return s; }
function keeps(...values: number[]): number { let s = 0; kept = values; for (let i = 0; i < values.length; i++) s += values[i]; return s; }
function returnsIt(...values: number[]): number[] { for (let i = 0; i < values.length; i++) if (values[i] < 0) return []; return values; }
function handsOn(...values: number[]): number { let s = 0; for (let i = 0; i < values.length; i++) s += Math.max(...values) + values[i]; return s; }
for (let i = 0; i < 4; i++) {
  console.log(storesInto(i, 1, 2), grows(i, 1), shrinks(i, 1, 2, 3), keeps(i, 5), kept.join(), returnsIt(i, 2).join(), returnsIt(i, -2).length, handsOn(i, 1, 7));
  kept.push(9);
}
console.log(kept.join());
// What each gives comes round the head of a loop: a look at that loop has promised what the sum holds.
let carried = 0;
for (let i = 0; i < 40; i++)
  carried += storesInto(i, 1, 2) + grows(i, 1) + shrinks(i, 1, 2, 3) + keeps(i, 5) + returnsIt(i, 2).length + handsOn(i, 1, 7);
console.log(carried);
