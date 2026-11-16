// The counter is the key of an object that is written out.
function mk(a, t) {
  let i = a.length - 1;
  do {
    if (a[i] === t) break;
  } while (--i >= 0);
  return { [i]: "here" };
}
console.log(JSON.stringify(mk(JSON.parse("[28,56,25]"), 30)));
