const kept = [];
function round(n) {
  let work = 0;
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  let total = n;
  function bump(by) { total += by; return total; }
  function* steps() {
    yield 1;
    yield { read: () => total, add: (by) => { total += by; return total; } };
    yield 2;
  }
  if (n & 1) {
    for (const step of steps()) {
      if (typeof step === "number") bump(step);
      else if (n & 2) kept.push(step);
    }
  }
  return bump(10) + work;
}
let sum = 0;
for (let n = 0; n < 200; n++) sum += round(n);
let wrong = 0;
for (let i = 0; i < kept.length; i++) {
  if (kept[i].read() !== 4 * i + 3 + 13) wrong++;
  if (kept[i].add(1) !== 4 * i + 3 + 14) wrong++;
}
for (let n = 0; n < 200; n++) sum += round(n);
for (let i = 0; i < 50; i++) if (kept[i].read() !== 4 * i + 3 + 14) wrong++;
console.log(wrong, kept.length, sum);
