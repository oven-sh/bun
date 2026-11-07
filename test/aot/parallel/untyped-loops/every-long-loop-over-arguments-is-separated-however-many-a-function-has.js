// Twenty calls with ten arguments in one function. The loop over `arguments` in each has too many turns to be written out: each is separated from its unlikely paths,
// and then no call makes its list. However many such loops a function has, each of them is separated.
// STATISTIC: LoopsSeparatedFromUnlikelyPaths >= 20
// COUNT: allCells <= 3000
function sumAfterFirst(first) {
  let sum = first;
  for (let k = 1; k < arguments.length; k++) sum += arguments[k];
  return sum;
}

const lines = [];
for (let i = 0; i < 400; i++) {
  const results = [
    sumAfterFirst(i, 1, 2, 3, 4, 5, 6, 7, 8, 9),
    sumAfterFirst(i, 2, 3, 4, 5, 6, 7, 8, 9, 0),
    sumAfterFirst(i, 3, 4, 5, 6, 7, 8, 9, 0, 1),
    sumAfterFirst(i, 4, 5, 6, 7, 8, 9, 0, 1, 2),
    sumAfterFirst(i, 5, 6, 7, 8, 9, 0, 1, 2, 3),
    sumAfterFirst(i, 6, 7, 8, 9, 0, 1, 2, 3, 4),
    sumAfterFirst(i, 7, 8, 9, 0, 1, 2, 3, 4, 5),
    sumAfterFirst(i, 8, 9, 0, 1, 2, 3, 4, 5, 6),
    sumAfterFirst(i, 9, 0, 1, 2, 3, 4, 5, 6, 7),
    sumAfterFirst(i, 0, 1, 2, 3, 4, 5, 6, 7, 8),
    sumAfterFirst(i, 1, 2, 3, 4, 5, 6, 7, 8, 9),
    sumAfterFirst(i, 2, 3, 4, 5, 6, 7, 8, 9, 0),
    sumAfterFirst(i, 3, 4, 5, 6, 7, 8, 9, 0, 1),
    sumAfterFirst(i, 4, 5, 6, 7, 8, 9, 0, 1, 2),
    sumAfterFirst(i, 5, 6, 7, 8, 9, 0, 1, 2, 3),
    sumAfterFirst(i, 6, 7, 8, 9, 0, 1, 2, 3, 4),
    sumAfterFirst(i, 7, 8, 9, 0, 1, 2, 3, 4, 5),
    sumAfterFirst(i, 8, 9, 0, 1, 2, 3, 4, 5, 6),
    sumAfterFirst(i, 9, 0, 1, 2, 3, 4, 5, 6, 7),
    sumAfterFirst(i, 0, 1, 2, 3, 4, 5, 6, 7, 8),
  ];
  if (i < 3 || i === 399) lines.push(results.join(" "));
}
console.log(lines.join("\n"));
console.log(sumAfterFirst("a", 1, 2, 3, 4, 5, 6, 7, 8, 9), sumAfterFirst(1, 2, 3, 4, 5, 6, 7, 8, 9, "z"), sumAfterFirst(0.5, 1, 2, 3, 4, 5, 6, 7, 8, 9.25));
