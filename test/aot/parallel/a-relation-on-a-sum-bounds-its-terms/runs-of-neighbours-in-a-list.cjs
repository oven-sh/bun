function idsOf(rows) {
  let result = "";
  const length = rows.length;
  let i = 0;
  while (i < length) {
    const start = rows[i].id;
    let count = 1;
    while (i + count < length && rows[i + count].id === start + count) count++;
    if (result.length) result += ",";
    result += start;
    if (count > 1) result += ":" + count;
    i += count;
  }
  return result;
}
function lengthsOfRuns(text) {
  const runs = [];
  for (let at = 0; at < text.length;) {
    let more = 1;
    while (at + more < text.length && text.charCodeAt(at + more) === text.charCodeAt(at)) more++;
    runs.push(text[at] + more);
    at += more;
  }
  return runs.join("");
}
const rowsOf = ids => ids.map(id => ({ id }));
globalThis.kept = [idsOf, lengthsOfRuns];
console.log(idsOf(rowsOf([1, 2, 3, 7, 9, 10, 4])), idsOf([]) + ".", idsOf(rowsOf([5])), idsOf(rowsOf([1.5, 2.5, 3.5, 0])), idsOf(rowsOf(["a", "a1", 2])));
console.log(idsOf(rowsOf(Array.from({ length: 300 }, (_, at) => at < 200 ? at : at * 2))));
console.log(lengthsOfRuns("aaabccdddd"), lengthsOfRuns("") + ".", lengthsOfRuns("z"), lengthsOfRuns("ééx"));
