// A big integer is made of the counter that has fallen below zero.
function find(list, wanted) {
  let i = list.length - 1;
  do {
    if (list[i] === wanted) break;
  } while (--i >= 0);
  return BigInt(i);
}
console.log(find(JSON.parse("[28,56,25]"), 30));
