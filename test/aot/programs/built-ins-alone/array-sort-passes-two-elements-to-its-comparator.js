const list = [2.5, 1.5];
list.sort(function (left, right) {
  console.log(typeof left, typeof right, left + right, this === undefined, arguments.length);
  return left - right;
});
console.log(list[0] + 1, list[1] + 1);
