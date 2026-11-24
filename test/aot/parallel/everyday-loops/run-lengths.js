// Runs of equal values packed into pairs and unpacked again
function pack(list) {
  const runs = [];
  for (let i = 0; i < list.length; ) {
    let k = i + 1;
    while (k < list.length && Object.is(list[k], list[i])) k++;
    runs.push([list[i], k - i]);
    i = k;
  }
  const back = [];
  for (const [value, times] of runs) for (let n = 0; n < times; n++) back.push(value);
  return runs.map(run => run.join("x")).join(" ") + " " + (back.length === list.length && back.every((value, i) => Object.is(value, list[i])));
}
console.log(pack([1, 1, 2, 3, 3, 3]));
console.log(pack(["a", "a", null, null, undefined, NaN, NaN, 0, -0]));
console.log(pack([]), pack([1.5]), pack([1, 1.5, 1.5, "1.5"]));
