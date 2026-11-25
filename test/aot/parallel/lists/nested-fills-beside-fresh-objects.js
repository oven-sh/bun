// A loop that fills a list stands in a loop beside objects that the function has made and neither loop names.
// STATISTIC: StoredValuesDistinguished >= 3
// STATISTIC: LoopVersioningAttemptsFailed = 0
function run(array, output) {
  const kept = [];
  const record = { best: -1 };
  let best = -1;
  for (let i = array.length - 1; i >= 0; i--) {
    let j = 0;
    do {
      output[j] = best;
      j++;
    } while (j < array.length);
    if (array[i] > best) best = array[i];
  }
  kept.push(best);
  return [kept.length, kept[0], record.best, output.join()].join(" ");
}
for (const text of ["[3, 1, 4]", "[0.5, 2.5, 1.5]", '["a", "c", "b"]', "[]", "[1, null, 2]", "[[2], 1]"]) {
  const array = JSON.parse(text);
  for (const output of [[], [1.5, 2], ["x"], new Uint8Array(3), new Float64Array(3), {}, array]) {
    let said;
    try {
      said = run(array, output);
    } catch (error) {
      said = error.constructor.name;
    }
    console.log(text, said, String(output[0]), output.length);
  }
}
