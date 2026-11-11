function isPrime(value: number): boolean {
  if (value < 2) return false;
  for (let by = 2; by * by <= value; by++) {
    if (value % by === 0) return false;
  }
  return true;
}
const found: number[] = [];
for (let value = 90; value < 120; value++) {
  if (isPrime(value)) found.push(value);
}
console.log(found.join());
