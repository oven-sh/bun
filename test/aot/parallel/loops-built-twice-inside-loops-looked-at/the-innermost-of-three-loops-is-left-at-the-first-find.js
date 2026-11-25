// As its sister; the innermost loop is left at the first element found and counts nothing.
function highest(first, second) {
  let largest = 0;
  for (let turn = 0; turn < first.length; turn++) {
    const chosen = turn % 2 ? first : second;
    for (let at = 0; at < chosen.length; at++) {
      const value = chosen[at];
      for (let other = 0; other < chosen.length; other++) if (chosen[other] === 2) break;
      if (value > largest) largest = value;
    }
  }
  return largest;
}
console.log(highest(JSON.parse("[2,7,2,9]"), [1.25, 2, 8.5]));
