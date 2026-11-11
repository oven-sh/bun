// The counter is handed to a function of the program's own, once below zero and once not.
function show(x) {
  return "at " + String(x);
}
function find(list, wanted) {
  let i = list.length - 1;
  do {
    if (list[i] === wanted) break;
  } while (--i >= 0);
  return show(i);
}
console.log(
  find(JSON.parse("[28,56,25]"), 30),
  find(JSON.parse("[28,56,25]"), 56),
);
