// Closures pushed by both levels capture elements and a counter
function make(list) {
  const calls = [];
  let used = 0;
  for (let i = 0; i < 3; i++) {
    for (let k = 0; k < 2; k++) calls.push(() => list[k] + used++);
    calls.push(() => list[i] * 2);
  }
  list[0] = list[2];
  return calls.map(call => call()).join() + " " + used + " " + calls.length;
}
console.log(make([1, 2, 3]));
console.log(make([5, 15, 25]));
console.log(make([10, 20, 30]));
