const total = ["a", 1.5, 2].reduce(function (kept, value, index, list) {
  console.log(typeof kept, typeof value, index + 1, list.length, this === undefined, arguments.length);
  return kept + value;
});
console.log(typeof total, total);
