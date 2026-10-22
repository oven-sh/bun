const set = new Set([1.5, "two"]);
set.forEach(function (value, again, whole) {
  console.log(typeof value, value === again, whole === set, this === undefined, arguments.length);
});
