// The same in a CommonJS file.
async function find(a, t) {
  let i = a.length - 1;
  do {
    if (a[i] === t) break;
  } while (--i >= 0);
  return i;
}
find(JSON.parse("[28,56,25]"), 30).then((r) =>
  console.log(r === -1 ? "not found" : "found at " + r, r < 0),
);
