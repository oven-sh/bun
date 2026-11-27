// The counter is laid into a field of a class.
function mk(a, t) {
  let i = a.length - 1;
  do {
    if (a[i] === t) break;
  } while (--i >= 0);
  class Hit {
    at = i;
  }
  return new Hit();
}
const hit = mk(JSON.parse("[28,56,25]"), 30);
console.log(hit.at, JSON.stringify(hit));
