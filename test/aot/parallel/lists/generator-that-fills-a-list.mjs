function* run(array) {
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
console.log([...run(JSON.parse("[3, 1, 4]"))].join());
