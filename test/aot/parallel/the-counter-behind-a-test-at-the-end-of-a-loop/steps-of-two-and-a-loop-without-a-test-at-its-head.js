// The counter falls by two, and falls in a loop that is left from its middle.
function find(list, wanted) {
  let i = list.length - 1;
  do {
    if (list[i] === wanted) break;
  } while ((i -= 2) >= 0);
  return String(i);
}
function forever(list, wanted) {
  let i = list.length - 1;
  for (;;) {
    if (list[i] === wanted) break;
    if (--i < 0) break;
  }
  return String(i);
}
console.log(
  find(JSON.parse("[28,56,25]"), 30),
  find(JSON.parse("[28,56,25,7]"), 30),
  forever(JSON.parse("[28,56,25]"), 30),
);
