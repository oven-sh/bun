// The hot loop's inlined two-turn loop over `arguments` is unrolled and its rest list is never made, although 22 more loops follow it in the same function.
// COUNT: branches <= 200000
// COUNT: allCells <= 10000
function sumAfterFirst(first) {
  let sum = first;
  for (let k = 1; k < arguments.length; k++) sum += arguments[k];
  return sum;
}

let often = 0;
for (let i = 0; i < 60000; i++) often += sumAfterFirst(i & 7, 0.5, 2);

const lines = [];
for (let i = 0; i < 400; i++) {
  const results = [
    sumAfterFirst(),
    sumAfterFirst(i),
    sumAfterFirst(i, 1),
    sumAfterFirst(i, 1, 2),
    sumAfterFirst(i, 1, 2, 3),
    sumAfterFirst("a", i),
    sumAfterFirst("a", i, 1.5),
    sumAfterFirst(i, "b", 2),
    sumAfterFirst(i, undefined, 2),
    sumAfterFirst(i, null, true),
    sumAfterFirst(0.5, i, -0),
    sumAfterFirst(i, NaN),
    sumAfterFirst(i, 4, 5, 6, 7),
    sumAfterFirst(i, 1, 2, 3, 4, 5, 6, 7, 8, 9),
    sumAfterFirst(i, 2, 2, 3, 4, 5, 6, 7, 8, 9),
    sumAfterFirst(i, 3, 2, 3, 4, 5, 6, 7, 8, 9),
    sumAfterFirst(i, 4, 2, 3, 4, 5, 6, 7, 8, 9),
    sumAfterFirst(i, 5, 2, 3, 4, 5, 6, 7, 8, 9),
    sumAfterFirst(i, 6, 2, 3, 4, 5, 6, 7, 8, 0.5),
    sumAfterFirst(i, 7, 2, 3, 4, 5, 6, 7, 8, "c"),
    sumAfterFirst(i, 8, 2, 3, 4, 5, 6, 7, 8, null),
    sumAfterFirst("d", 9, 2, 3, 4, 5, 6, 7, 8, 9),
  ];
  if (i < 3 || i === 399) lines.push(results.join(" "));
}
console.log(often);
console.log(lines.join("\n"));
