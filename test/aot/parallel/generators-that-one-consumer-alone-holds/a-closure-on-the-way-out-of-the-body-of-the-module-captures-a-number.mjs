function* numbers(limit) {
  for (let i = 0; i < limit; i++) yield i;
}
let found = null;
for (const value of numbers(6)) {
  if (value > 3) {
    const step = (value * 3) | 0;
    found = () => { let sum = 0; for (let i = 0; i < 10; i++) sum += step; return sum; };
    break;
  }
}
console.log(found === null ? "none" : found());
