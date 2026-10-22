const sorted = [2.5, 1.5].toSorted(function (left, right) {
  console.log(typeof left, typeof right, left + right, this === undefined, arguments.length);
  return left - right;
});
console.log(sorted[0] + 1);
