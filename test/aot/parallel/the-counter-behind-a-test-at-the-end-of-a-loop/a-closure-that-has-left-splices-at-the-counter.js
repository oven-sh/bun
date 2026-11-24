// A closure that has left the function splices at the counter that has fallen below zero.
function mk(a, t) {
  let i = a.length - 1;
  do {
    if (a[i] === t) break;
  } while (--i >= 0);
  return () => i;
}
const h = mk(JSON.parse("[28,56,25]"), 30);
const l = [1, 2, 3];
l.splice(h(), 1);
console.log(l.join());
