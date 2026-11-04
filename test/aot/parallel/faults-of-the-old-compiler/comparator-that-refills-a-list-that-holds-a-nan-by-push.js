// The comparator of a sort empties the list that is being sorted, which held a NaN, pushes whole numbers and loops over it.
let first = true;
function total(a) { let s = 0; for (let i = 0; i < a.length; i++) s += a[i]; return s; }
const list = [3.5, NaN, 17.5];
list.sort((p, q) => {
  if (first) { first = false; list.length = 0; list.push(2, 2, 2); total(list); }
  return p < q ? -1 : p > q ? 1 : 0;
});
console.log(list.length, 1 in list, list[1], list.includes(NaN));
