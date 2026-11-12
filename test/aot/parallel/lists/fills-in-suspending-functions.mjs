// A value from in front is stored into lists by loops of generators and async functions.
// STATISTIC: StoredValuesDistinguished >= 6
// STATISTIC: LoopVersioningAttemptsFailed = 0
function* nested(array) {
  const output = [];
  let best = -1;
  for (let i = array.length - 1; i >= 0; i--) {
    let j = 0;
    do {
      output[j] = best;
      j++;
    } while (j < array.length);
    if (array[i] > best) best = array[i];
  }
  yield output.join();
}
function* handed(array, output, value) {
  for (let turn = 0; turn < 2; turn++) {
    for (let j = 0; j < array.length; j++) output[j] = value;
    yield output.join();
    value = array[turn];
  }
}
async function awaited(array, output, value) {
  const kept = [value];
  for (let j = 0; j < array.length; j++) output[j] = value;
  await 0;
  for (let j = 0; j < output.length; j++) output[j] = kept[0];
  return output.join();
}
async function* both(array, output, value) {
  for (let turn = 0; turn < 2; turn++) {
    for (let j = 0; j < array.length; j++) output[j] = value;
    yield output.join();
    value = await array[turn];
  }
}
for (const text of ["[3, 1, 4]", "[0.5, 2.5, 1.5]", '["a", "c", "b"]', "[]", "[1, null, 2]"]) {
  const array = JSON.parse(text);
  console.log(text, [...nested(array)].join());
  for (const value of [7, 0.5, -0, "t", undefined, array[0]]) {
    for (const output of [[], [1.5, 2], ["x"], array.slice()]) {
      console.log([...handed(array, output.slice(), value)].join(" "));
      const steps = handed(array, output.slice(), value);
      console.log(steps.next().value, steps.next().value);
      console.log(await awaited(array, output.slice(), value));
      let said = "";
      for await (const step of both(array, output.slice(), value)) said += step + "|";
      console.log(said);
    }
  }
}
