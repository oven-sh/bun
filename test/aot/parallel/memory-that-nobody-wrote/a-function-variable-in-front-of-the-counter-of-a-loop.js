// Its answer was never wrong. It is red only under the net of two fill bytes: an ASan engine compiles it under ASAN_OPTIONS=max_malloc_fill_size=67108864:malloc_fill_byte=0 and =255, one thread, and the two images must be one.
function stop(marks) {
  marks.push("stop");
}
function go(marks, sums) {
  sums.push(marks.length);
  return true;
}
function walk(numbers) {
  const sums = [];
  const marks = [];
  let step = go;
  for (let at = 0; at < numbers.length; at++) {
    if (numbers[at] === 7) {
      if (!step(marks, sums))
        break;
      step = stop;
    }
  }
  return sums.length + " " + marks.join() + " " + (step === stop);
}
for (const numbers of [[1, 7, 2, 7, 7, 3], [7], [], [1, 2]])
  console.log(walk(numbers));
