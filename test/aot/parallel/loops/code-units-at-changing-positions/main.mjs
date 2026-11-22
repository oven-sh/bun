// STATISTIC: RangeChecksRemoved >= 8
function tally(text, place, turns) {
  let sum = 0, odd = 0;
  for (let row = 0; row < text.length; row++) {
    sum += text.charCodeAt(row);
    const at = (row + place) & 3;
    for (let turn = 0; turn < turns; turn++) {
      if (at >= text.length) break;
      if (turn & 1) odd++;
      sum += text.charCodeAt(at);
    }
  }
  return sum + odd;
}

function elements(text, place, turns) {
  let told = "", odd = 0;
  for (let row = 0; row < text.length; row++) {
    told += text[row];
    const at = (row * 3 + place) & 3;
    for (let turn = 0; turn < turns; turn++) {
      if (at >= text.length) return told;
      if (turn > 1) odd += at;
      told += text[at];
    }
  }
  return told + odd;
}

function behindATest(text, place, turns) {
  let sum = 0, few = 0;
  for (let row = 0; row < text.length; row++) {
    sum ^= text.charCodeAt(row) << (row & 7);
    const at = place & 1;
    for (let turn = 0; turn < turns; turn++) {
      if (text.length < 4) break;
      if (turn & 1) few--;
      sum += text.charCodeAt(at);
    }
  }
  return sum + few;
}

// Each text is longer than the place is great.
for (const text of ["meadow", "hedgerow", "überall", "plum tree", String(20261119), "sedge".repeat(3)]) {
  for (const place of [0, 1, 2, 3, 7, -1]) {
    for (const turns of [0, 1, 4]) console.log(place, turns, tally(text, place, turns), elements(text, place, turns), behindATest(text, place, turns));
  }
}
