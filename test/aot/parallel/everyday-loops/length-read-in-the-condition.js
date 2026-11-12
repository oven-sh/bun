// The length is read anew by every condition while the body changes the list
function expand(list, limit) {
  for (let i = 0; i < list.length; i++) {
    if (list.length < limit && list[i] > 1) list.push(list[i] - 1);
    for (let k = list.length - 1; k > i; k--) {
      if (list[k] === list[i] && list.length > limit / 2) list.splice(k, 1);
    }
  }
  return list.join();
}
console.log(expand([3, 5], 12));
console.log(expand([4, 4, 2.5, 0.5], 9));
console.log(expand([1, 1, 1, 1], 2), expand([], 5));
