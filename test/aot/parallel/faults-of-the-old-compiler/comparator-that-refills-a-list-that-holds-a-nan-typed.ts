// The comparator of a sort fills the list that is being sorted, which held a NaN, with whole numbers and loops over it: typed.
let first = true;
function total(a: number[]) { let s = 0; for (let i = 0; i < a.length; i++) s += a[i]; return s; }
const list: number[] = [3.5, NaN, 17.5];
list.sort((p, q) => {
  if (first) { first = false; list.fill(2); total(list); }
  return p < q ? -1 : p > q ? 1 : 0;
});
console.log(list.length, 1 in list, list[1], list.includes(NaN));
export {};
