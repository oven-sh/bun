// do while loops inside each other, with a continue in the condition's way
function collatz(starts) {
  const out = [];
  let i = 0;
  if (starts.length) do {
    let value = starts[i];
    let steps = 0;
    do {
      if (value === 1 || steps > 40) continue;
      value = value % 2 === 0 ? value / 2 : value * 3 + 1;
      steps++;
      if (steps % 5 === 0) out.push(value);
    } while (value !== 1 && steps <= 40);
    out.push(starts[i] + ":" + steps);
  } while (++i < starts.length);
  return out.join(" ");
}
console.log(collatz([6, 7]));
console.log(collatz([27, 1]));
console.log(collatz([]), collatz([0.5, -1]));
