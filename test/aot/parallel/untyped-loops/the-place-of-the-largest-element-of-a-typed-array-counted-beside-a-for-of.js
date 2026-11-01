function place(v, start) {
  let g = start, other = start, k = -1;
  for (const x of v) { k++; if (x > g) { g = x; other = k; } }
  return g + "," + other;
}
console.log(place(new Int16Array(8), 0));
console.log(place(Int16Array.of(1, 5, 9, 3, 9, 2, 0, 4), 0));
