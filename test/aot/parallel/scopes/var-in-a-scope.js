const unseen = (0, eval)("(x) => x");
function each(list, callback) { for (let i = 0; i < list.length; i++) callback(list[i]); }
function sumWith(list) {
  var total = 0;
  var seen = 0;
  each(list, function (v) { total += v; seen++; });
  return total + seen;
}
const list = unseen([1, 2, 3, 4, 5, 6, 7, 8]);
let all = 0;
for (let round = 0; round < 2000000; round++) all += sumWith(list);
console.log(all);
