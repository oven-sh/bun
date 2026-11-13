// A closure that has left the function stores into a typed list under the counter that has fallen below zero.
function mk(a, t) {
  let i = a.length - 1;
  do {
    if (a[i] === t) break;
  } while (--i >= 0);
  return () => i;
}
const h = mk(JSON.parse("[28,56,25]"), 30);
const v = new Int32Array(3);
v[h() + 1] = 7;
console.log(v.join());
