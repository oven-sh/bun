function* numbers(limit) {
  for (let i = 0; i < limit; i++) yield i;
}
function findStep(limit) {
  let found = null;
  for (const value of numbers(limit)) {
    if (value > 3) {
      const step = (value * 3) | 0;
      found = () => { let sum = 0; for (let i = 0; i < 10; i++) sum += step; return sum; };
      break;
    }
  }
  return found;
}
const read = findStep(6);
console.log(read === null ? "none" : read());
