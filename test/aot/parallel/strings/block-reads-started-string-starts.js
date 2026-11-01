// The block behind the two tests reads the string that the first return ends, so it gets a copy of that string's start; and it starts a string of its own, which the second return ends.
function join(n, a, b) {
  const first = n + ":";
  if (a) {
    if (b) return first + n;
  }
  const whole = first + n;
  const second = n + "-";
  if (b) return second + n;
  return whole;
}
for (let n = 0; n < 3; n++) for (const a of [true, false]) for (const b of [true, false]) console.log(join(n, a, b));
