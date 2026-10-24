// `sort` writes the sorted list back even when nothing moved, over what the comparator stored.
const a = [1, 2];
console.log(a.sort((x, y) => (a[0] = 9, x - y)).join());
