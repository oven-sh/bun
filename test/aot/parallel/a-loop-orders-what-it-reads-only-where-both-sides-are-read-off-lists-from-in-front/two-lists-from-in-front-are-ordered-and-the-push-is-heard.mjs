// STATISTIC: LocalArrayMethodEffectsNarrowed >= 2
// The event itself: the loop holds an element of one list from in front against an element of another and pushes the lesser into a list made here: the push is heard as a writer of that list alone. (One hearing is the library's own.)
function merged(left, right) {
  const out = [];
  let a = 0, b = 0;
  while (a < left.length && b < right.length) out.push(left[a] <= right[b] ? left[a++] : right[b++]);
  return out.join();
}
const table = { merged };
console.log(table[JSON.parse('"merged"')](JSON.parse("[1,4,7,10]"), JSON.parse("[2,3,8,9,11]")));
