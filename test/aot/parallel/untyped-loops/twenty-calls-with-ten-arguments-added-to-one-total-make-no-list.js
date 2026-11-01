// Twenty calls with ten arguments in one loop, each added to one total: no call makes its list, however many calls stand in the loop.
// COUNT: allCells <= 3000
function sumAfterFirst(first) {
  let sum = first;
  for (let k = 1; k < arguments.length; k++) sum += arguments[k];
  return sum;
}

let total = 0;
for (let i = 0; i < 400; i++) {
  total += sumAfterFirst(i, 1, 2, 3, 4, 5, 6, 7, 8, 9);
  total += sumAfterFirst(i, 2, 3, 4, 5, 6, 7, 8, 9, 0);
  total += sumAfterFirst(i, 3, 4, 5, 6, 7, 8, 9, 0, 1);
  total += sumAfterFirst(i, 4, 5, 6, 7, 8, 9, 0, 1, 2);
  total += sumAfterFirst(i, 5, 6, 7, 8, 9, 0, 1, 2, 3);
  total += sumAfterFirst(i, 6, 7, 8, 9, 0, 1, 2, 3, 4);
  total += sumAfterFirst(i, 7, 8, 9, 0, 1, 2, 3, 4, 5);
  total += sumAfterFirst(i, 8, 9, 0, 1, 2, 3, 4, 5, 6);
  total += sumAfterFirst(i, 9, 0, 1, 2, 3, 4, 5, 6, 7);
  total += sumAfterFirst(i, 0, 1, 2, 3, 4, 5, 6, 7, 8);
  total += sumAfterFirst(i, 1, 2, 3, 4, 5, 6, 7, 8, 9);
  total += sumAfterFirst(i, 2, 3, 4, 5, 6, 7, 8, 9, 0);
  total += sumAfterFirst(i, 3, 4, 5, 6, 7, 8, 9, 0, 1);
  total += sumAfterFirst(i, 4, 5, 6, 7, 8, 9, 0, 1, 2);
  total += sumAfterFirst(i, 5, 6, 7, 8, 9, 0, 1, 2, 3);
  total += sumAfterFirst(i, 6, 7, 8, 9, 0, 1, 2, 3, 4);
  total += sumAfterFirst(i, 7, 8, 9, 0, 1, 2, 3, 4, 5);
  total += sumAfterFirst(i, 8, 9, 0, 1, 2, 3, 4, 5, 6);
  total += sumAfterFirst(i, 9, 0, 1, 2, 3, 4, 5, 6, 7);
  total += sumAfterFirst(i, 0, 1, 2, 3, 4, 5, 6, 7, 8);
}
console.log(total);
console.log(sumAfterFirst("a", 1, 2, 3, 4, 5, 6, 7, 8, 9), sumAfterFirst(1, 2, 3, 4, 5, 6, 7, 8, 9, "z"), sumAfterFirst(0.5, 1, 2, 3, 4, 5, 6, 7, 8, 9.25));
