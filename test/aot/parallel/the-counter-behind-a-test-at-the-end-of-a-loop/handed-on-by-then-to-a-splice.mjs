// What an async function returned goes through then to a splice.
async function find(a, t) {
  let i = a.length - 1;
  do {
    if (a[i] === t) break;
  } while (--i >= 0);
  return i;
}
find(JSON.parse("[28,56,25]"), 30).then((r) => {
  const l = [1, 2, 3];
  l.splice(r, 1);
  console.log(l.join());
});
