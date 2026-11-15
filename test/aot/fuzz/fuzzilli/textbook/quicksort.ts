function sorted(list: number[], low = 0, high = list.length - 1): number[] {
  if (low >= high) return list;
  const pivot = list[high];
  let at = low;
  for (let i = low; i < high; i++) {
    if (list[i] < pivot) {
      [list[i], list[at]] = [list[at], list[i]];
      at++;
    }
  }
  [list[at], list[high]] = [list[high], list[at]];
  sorted(list, low, at - 1);
  return sorted(list, at + 1, high);
}
console.log(sorted(JSON.parse("[3,6,1,8,2,9,2]")).join());
