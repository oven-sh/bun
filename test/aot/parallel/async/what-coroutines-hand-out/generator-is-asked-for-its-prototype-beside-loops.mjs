// Most calls of a generator function go into loops. One generator is asked what it stands below, which is the object under `prototype` of the function.
// Under: --aot-testing=CheckProofsAtRunTime: that only loops take the generators of count() (LinkedCoroutine::objectsAreOnlyIterated)
function* count(n) {
  for (let i = 0; i < n; i++) yield i;
}
function looped(n) {
  let sum = 0;
  for (const value of count(n)) sum += value;
  return sum;
}
function deed() {
  const above = Object.getPrototypeOf(count(1));
  return [above === count.prototype, Object.getPrototypeOf(above) === Object.getPrototypeOf(function* () {}).prototype, count(1) instanceof count].join();
}
console.log(looped(4));
for (let i = 0; i < 300; i++) {
  if (looped(3) !== 3) console.log("wrong at", i);
}
console.log(deed());
console.log(looped(5));
