// The counter is thrown.
function mk(a, t) {
  let i = a.length - 1;
  do {
    if (a[i] === t) break;
  } while (--i >= 0);
  throw i;
}
try {
  mk(JSON.parse("[28,56,25]"), 30);
} catch (e) {
  console.log("caught", e);
}
