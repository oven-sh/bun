// It runs in a turn of the event loop behind the file's own.
// STATISTIC: FunctionsLowered >= 300
function pick(from, key) {
  return from[key];
}
setTimeout(() => {
  console.log(String(pick([1, 2, 3], ["to", "Reversed"].join("")).call([1, 2, 3])));
}, 1);
console.log("first");
