// A counter that rises until it is no longer below zero, and one that falls past the least int32.
function least(list, floor) {
  let i = -list.length;
  do {
    if (list[-i - 1] === floor) break;
  } while (++i < 0);
  return String(i);
}
function farBelow(list, start) {
  let i = start;
  do {
    if (list[i] === 1) break;
  } while (--i >= -2147483647);
  return String(i);
}
console.log(
  least(JSON.parse("[28,56,25]"), 30),
  least(JSON.parse("[28,56,25]"), 56),
  farBelow(JSON.parse("[28,56,25]"), -2147483646),
);
