// Alone: which kind of array a reader asks for first goes by every array that the executable holds
// A read, a store through a second name of the same array, then a read: a function that was handed in stores through the second name.
var neverTaken = process.argv.length > 99;
function touch(list: any[]): any { if (neverTaken) list[0] = "s"; return list; }
function general(): number[] { return touch([1, 2, 3, 4, 5, 6]); }
function fractions(): number[] { return [1.5, 2.5, 3.5, 4.5, 5.5, 6.5]; }
function whole(): number[] { return [1, 2, 3, 4, 5, 6]; }
function walk(L: number[], f: (at: number) => void, n: number, k: number): number {
  let t = 0;
  for (let i = 0; i < n; i++) {
    t += L[k];
    f(i);
    t += L[k];
  }
  return t;
}
console.log(walk(general(), at => {}, 5, 5));
{ const same = fractions(); console.log(walk(same, at => { same[at] = NaN; }, 5, 5), same.join()); }
{ const same = fractions(); console.log(walk(same, at => { same[at] = NaN; }, 5, 5), same.join()); }
