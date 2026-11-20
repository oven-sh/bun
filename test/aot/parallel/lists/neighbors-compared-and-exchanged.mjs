// Flags: --aot-harden=proof-checks
// A check before a loop that an earlier check answers narrows nothing: a narrowed value is right behind the branch on its test.
function exchange(list, count) {
  let sum = 0;
  for (let i = count - 1; i >= 1; i--) {
    if (list[i - 1] <= list[i]) [list[i], list[i - 1]] = [list[i - 1], list[i]];
    sum += list[i];
  }
  return [list, sum];
}
function rounds(list, count) {
  let swapped = true, sum = 0, left = 9;
  while (swapped && left-- > 0) {
    swapped = false;
    for (let i = count - 1; i >= 1; i--) {
      if (list[i - 1] > list[i]) {
        [list[i], list[i - 1]] = [list[i - 1], list[i]];
        swapped = true;
      }
      sum += list[i];
    }
  }
  return [list, sum];
}
for (const count of [2, 5, 8]) {
  for (const list of [[5, 3, 9, 1, 7, 2, 8, 4], [3, 1, 2]]) console.log(exchange(list.slice(), count).join(), rounds(list, count).join());
}
