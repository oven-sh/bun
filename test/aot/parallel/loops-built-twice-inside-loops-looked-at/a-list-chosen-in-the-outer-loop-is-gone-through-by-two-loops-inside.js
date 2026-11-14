// The outer loop chooses one of two lists whose elements nobody knows; two loops inside go through the chosen list, and behind the innermost the largest element is kept.
function tally(first, second) {
  let hits = 0, largest = 0;
  for (let turn = 0; turn < first.length; turn++) {
    const chosen = turn % 2 ? first : second;
    for (let at = 0; at < chosen.length; at++) {
      const value = chosen[at];
      for (let other = 0; other < chosen.length; other++) if (chosen[other] === 2) hits++;
      if (value > largest) largest = value;
    }
  }
  return hits + ":" + largest;
}
console.log(tally(JSON.parse("[2,7,2,9]"), [1.25, 2, 8.5]));
console.log(tally(JSON.parse('["b","a",2]'), JSON.parse("[3,null,2,2]")));
