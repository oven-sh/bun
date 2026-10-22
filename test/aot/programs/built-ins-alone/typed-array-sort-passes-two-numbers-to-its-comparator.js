const view = new Float64Array([1.5, 2.5]);
view.sort(function (left, right) {
  console.log(typeof left, typeof right, left + right, this === undefined, arguments.length);
  return right - left;
});
console.log(view[0] + 1);
