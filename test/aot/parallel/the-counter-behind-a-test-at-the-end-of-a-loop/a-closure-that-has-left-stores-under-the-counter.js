// A closure that has left the function stores under the counter that has fallen below zero.
function mk(a, t) {
  let i = a.length - 1;
  do {
    if (a[i] === t) break;
  } while (--i >= 0);
  return (list) => {
    list[i + 1] = 7;
    return list;
  };
}
const out = mk(JSON.parse("[28,56,25]"), 30)([1, 2, 3]);
console.log(out.join(), Object.keys(out).join());
