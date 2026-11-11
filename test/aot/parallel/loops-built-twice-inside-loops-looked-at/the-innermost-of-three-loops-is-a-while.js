// As its sister, with a `while` as the innermost loop.
function tally(first, second) {
  let hits = 0, largest = 0;
  for (let turn = 0; turn < first.length; turn++) {
    const chosen = turn % 2 ? first : second;
    for (let at = 0; at < chosen.length; at++) {
      const value = chosen[at];
      let other = 0;
      while (other < chosen.length) { if (chosen[other] === 2) hits++; other++; }
      if (value > largest) largest = value;
    }
  }
  return hits + ":" + largest;
}
console.log(tally(JSON.parse("[2,7,2,9]"), [1.25, 2, 8.5]));
