// A counter that a test at the end of its loop has seen fall below zero is handed on as it is.
function find(list, wanted) {
  let i = list.length - 1;
  do {
    if (list[i] === wanted) break;
  } while (--i >= 0);
  console.log(i, Object.is(i, -1));
  return String(i);
}
console.log(find(JSON.parse("[28,56,25]"), 30));
