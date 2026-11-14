// An inner loop holds the elements of an array that nobody types against those of an array of numbers.
// STATISTIC: ElementsHeldAgainstNumbers >= 2
function pairs(x, y, rounds) {
  let same = 0;
  for (let k = 0; k < rounds; k++) for (let i = 0; i < 40; i++) if (x[i] === y[i]) same++;
  return same;
}
function beside(x, y, rounds) {
  const kept = [], record = { count: 0 };
  for (let k = 0; k < rounds; k++) {
    let n = 0;
    for (let i = 0; i < 40; i++) if (x[i] !== y[i]) n++;
    record.count += n;
  }
  kept.push(record.count);
  return kept.length + " " + kept[0];
}
const numbers = JSON.parse("[[1,2,3,4,5,6],[0.5,1.5,2.5,3.5,4.5,5.5],[1,2.5,3,4.5,5,6.5]]");
const others = [[1, 2, 3, 4, 5, 6], [0.5, 1.5, 2.5], ["1", "2", "3"], [1, null, undefined, 4], [NaN, 2, -0], [], [1, , 3, , 5], new Float64Array(6), new Uint8Array([1, 2, 3, 4, 5, 6]), "123456", [1n, 2n], [{}, [1]]];
let calls = 0;
others.push(Object.defineProperty([1, 2, 3, 4, 5, 6], 2, { get() { calls++; return 3; } }));
for (const x of numbers) for (const y of others) console.log(pairs(x, y, 3), beside(x, y, 2), pairs(numbers[0], x, 2), calls);
