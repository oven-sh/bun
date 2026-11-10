// STATISTIC: MethodsOfListsHeardInLoopsAsWritersOfListsMadeHere <= 1
// The twins that do not count as "the loop orders what it reads": what is held against one another is read off rows that the turn itself has read; or it is two lengths; or the ordering stands in an inner loop. (One hearing is the library's own.)
function walked(rows, a, b) {
  const out = [];
  let i = 0, j = 0;
  while (i < a.length && j < b.length) {
    if (rows[i + 1][j] >= rows[i][j + 1]) out.push({ op: "-", line: a[i++] });
    else out.push({ op: "+", line: b[j++] });
  }
  return out.map(one => one.op + one.line).join();
}
function byLengths(left, right) {
  const out = [];
  for (let k = 0; k < left.length; k++) out.push(left[k].length <= right[k].length ? "l" : "r");
  return out.join();
}
const table = { walked, byLengths };
console.log(table[JSON.parse('"walked"')](JSON.parse("[[3,2,1,0],[2,2,1,0],[1,1,1,0],[0,0,0,0]]"), JSON.parse('["a","b","c"]'), JSON.parse('["b","c","d"]')));
console.log(table[JSON.parse('"byLengths"')](JSON.parse('["a","bbb","cc"]'), JSON.parse('["aa","b","cc"]')));
