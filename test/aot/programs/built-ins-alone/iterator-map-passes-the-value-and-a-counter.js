console.log([...[1.5, "two"].values().map(function (value, counter) {
  console.log(typeof value, counter + 1, this === undefined, arguments.length);
  return counter;
})].join());
