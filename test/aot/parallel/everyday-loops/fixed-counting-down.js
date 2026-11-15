// Counters that go down, with pushes at both levels
function countdown(step) {
  const out = [];
  for (let i = 4; i > 0; i--) {
    for (let k = i; k >= 0; k -= 2) out.push(k * step);
    out.push(i);
  }
  for (let i = out.length; i--; ) if (i % 4 === 3) out.push(out[i]);
  return out.join();
}
console.log(countdown(1));
console.log(countdown(0.5));
console.log(countdown(-7), countdown("2"));
