// Closures keep the counter that has fallen below zero.
function find(list, wanted) {
  let at = list.length - 1;
  do {
    if (list[at] === wanted) break;
  } while (--at >= 0);
  return { found: () => at >= 0, index: () => at };
}
const none = find(JSON.parse("[28,56,25]"), 30);
console.log(none.found(), none.index(), none.index() === -1, none.index() + 1);
