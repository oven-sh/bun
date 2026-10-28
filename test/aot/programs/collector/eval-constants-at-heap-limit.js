// Evaluates source text that holds constant arrays and BigInt literals while the heap is full.
// Plain Bun has no heap limit, so the loop also stops at a fixed count.
const most = 1_500_000;

function fill(shift) {
  const lists = [];
  for (let made = 0; made < most; made += 1024) {
    const items = [];
    lists.push(items);
    for (let at = 0; at < 1024; at++) items.push((BigInt(at) + 1n) << shift);
  }
}

const texts = [
  "[1, 2, 3].length",
  "[1.5, 2.5].length",
  "['a', 'b'].join()",
  "[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].length",
  "64n + 1n",
  "12345678901234567890123n * 2n",
];
const shifts = [1n, 64n, 128n, 1n, 64n, 1n];
const results = new Array(texts.length).fill("");

function ignoreRangeError(run) {
  try {
    run();
  } catch (error) {
    if (!(error instanceof RangeError)) throw error;
  }
}

for (let index = 0; index < texts.length; index++) {
  try {
    ignoreRangeError(() => fill(shifts[index]));
  } catch (error) {
    if (!(error instanceof RangeError)) throw error;
  }
  for (let attempt = 0; attempt < 4 && results[index] === ""; attempt++) {
    try {
      results[index] = String((0, eval)(texts[index]));
    } catch (error) {
      if (!(error instanceof RangeError)) throw error;
    }
  }
}
for (let attempt = 0; attempt < 4; attempt++) {
  try {
    console.log(results.join(" "));
    break;
  } catch (error) {
    if (!(error instanceof RangeError)) throw error;
  }
}
