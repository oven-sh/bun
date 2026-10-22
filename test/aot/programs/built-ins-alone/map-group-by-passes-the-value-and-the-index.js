Map.groupBy([1.5, "two"], function (value, index) {
  console.log(typeof value, index + 1, this === undefined, arguments.length);
  return index;
});
