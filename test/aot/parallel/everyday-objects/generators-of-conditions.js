// A generator whose values are chosen by a condition, read by next alone
function* choose(n, at) {
  for (let i = 0; i < n; i++) yield i === at ? NaN : i;
}
function read(n, at) {
  const iterator = choose(n, at);
  const out = [];
  let result = iterator.next();
  while (!result.done) {
    out.push(result.value);
    result = iterator.next();
  }
  return out.join() + " " + out.length;
}
console.log(read(4, 1));
console.log(read(3, 0));
console.log(read(2, 9));
