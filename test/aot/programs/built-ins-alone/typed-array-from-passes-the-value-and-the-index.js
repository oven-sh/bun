const view = Float64Array.from([1, 2], function (value, index) {
  console.log(typeof value, index, this === undefined, arguments.length);
  return value + 0.5;
});
console.log(view[1] + 1);
