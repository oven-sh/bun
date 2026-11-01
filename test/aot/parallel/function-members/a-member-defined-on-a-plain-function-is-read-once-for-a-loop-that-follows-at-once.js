// A plain function that gets a member by Object.defineProperty, and a loop that calls the member right behind the definition. No turn of the loop looks the name up.
// COUNT: arrivals <= 40
function increment(a) {
  return a + 1;
}
Object.defineProperty(increment, "other", { value: increment, writable: true, configurable: true });
function turn(i) {
  return increment.other(i & 7);
}
function sumOf(turns) {
  let sum = 0;
  for (let i = 0; i < turns; i++) sum += turn(i);
  return sum;
}
console.log(sumOf(5000), Object.keys(increment).length, Object.getOwnPropertyNames(increment).join());
