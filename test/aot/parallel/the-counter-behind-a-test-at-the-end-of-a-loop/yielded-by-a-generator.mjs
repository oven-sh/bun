// A generator yields the counter that has fallen below zero.
function* find(a, t) {
  let i = a.length - 1;
  do {
    if (a[i] === t) break;
  } while (--i >= 0);
  yield i;
}
const [r] = find(JSON.parse("[28,56,25]"), 30);
console.log(r === -1 ? "not found" : "found at " + r);
