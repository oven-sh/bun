// A sum and a count are both read behind the outer loop, and the outer loop may be left early.
function tally(text, stop) {
  const list = Array.from(JSON.parse(text));
  let sum = 0, count = 0;
  for (let i = list.length - 1; i >= 0; i--) {
    sum += list[i];
    if (sum > stop) break;
    for (let j = 0; j < list.length; j++) {
      sum += list[j];
      count++;
    }
  }
  return sum + ":" + count;
}
console.log(tally("[1,2,3]", 100), tally("[1,2,3]", 8), tally("[1,2,3]", 0), tally("[0.5,2,3]", 9), tally("[]", 1));
