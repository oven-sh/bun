// Lists that nothing else holds are searched from either end with Boolean as the callee: lists of integers, of fractions and of texts.
// No method of a list has another callee here, so each of them is compiled for Boolean alone and calls nothing while it walks.
// The build puts a word that names nothing into every register and spilled word whose value is not read again, in front of each place where the collector can run.
console.log([1].findLast(Boolean));
console.log([1].findLastIndex(Boolean));
console.log([0.5, 0].findLast(Boolean), [0.5, 0].findLastIndex(Boolean), ["", "a", ""].findLast(Boolean), [].findLast(Boolean));

const length = 900;
const zeros = ",0".repeat(length - 1);
const emptyTexts = ',""'.repeat(length - 1);
const makers = {
  integers: turn => JSON.parse("[" + (turn + 1) + zeros + "]"),
  fractions: turn => JSON.parse("[" + (turn + 0.5) + zeros + "]"),
  fractionsAtTheEnd: turn => JSON.parse("[0" + zeros + "," + (turn + 0.25) + "]"),
  texts: turn => JSON.parse('["' + turn + '"' + emptyTexts + "]"),
  copiesOfFloats: turn => Array.from(new Float64Array(length).fill(turn + 0.125, 0, 1)),
};

for (const [name, make] of Object.entries(makers)) {
  let found = 0;
  let places = 0;
  let kept = 0;
  for (let turn = 0; turn < 300; turn++) {
    found += Number(make(turn).findLast(Boolean)) + Number(make(turn).find(Boolean));
    places += make(turn).findLastIndex(Boolean) + make(turn).findIndex(Boolean);
    kept += make(turn).filter(Boolean).length + Number(make(turn).some(Boolean)) + Number(make(turn).every(Boolean));
  }
  console.log(name, found, places, kept);
}
