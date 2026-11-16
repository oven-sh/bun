function* numbers(limit) {
  for (let i = 4; i < limit; i++) yield i;
}
function firstStep(limit) {
  let found = null;
  for (const value of numbers(limit)) {
    const step = (value * 3) | 0;
    found = () => { let sum = 0; for (let i = 0; i < 10; i++) sum += step; return sum; };
    break;
  }
  return found;
}
const read = firstStep(6);
console.log(read === null ? "none" : read());
