function step(i, at) {
  if (i === at) throw new RangeError("at " + i);
  return i * 2;
}
function run(n, at) {
  let sum = 0,
    last = -1,
    untouched = 5,
    turns = 0;
  try {
    for (let i = 0; i < n; i++) {
      turns = turns + 1;
      last = i;
      sum = sum + step(i, at);
    }
    while (untouched !== untouched) untouched = [untouched];
    for (let i = 0; i < 3; i++) {
      sum = sum + step(i + 100, at);
      last = i + 100;
    }
  } catch (e) {
    return [e.message, sum, last, untouched, turns].join();
  }
  return [sum, last, untouched, turns].join();
}
console.log([run(4, 9), run(4, 2), run(4, 0), run(2, 101), run(0, 100)].join(" . "));
