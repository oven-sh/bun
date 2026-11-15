// Two indexes that run through two lists, pushing what both have
function merge(a, b) {
  const both = [];
  const all = [];
  let i = 0, k = 0;
  while (i < a.length || k < b.length) {
    if (k >= b.length || a[i] < b[k]) all.push(a[i++]);
    else if (i >= a.length || b[k] < a[i]) all.push(b[k++]);
    else {
      both.push(a[i]);
      all.push(a[i++]);
      k++;
    }
    if (all.length > 20) break;
  }
  return all.join() + " & " + both.join();
}
console.log(merge([1, 3, 5], [2, 3, 4, 5]));
console.log(merge([0.5, 1], [0.5, 0.75, 2]));
console.log(merge(["a", "c"], ["b", "c", "d"]), merge([], [1]));
