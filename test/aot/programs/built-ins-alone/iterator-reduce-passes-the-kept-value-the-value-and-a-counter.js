console.log(["a", 1.5].values().reduce(function (kept, value, counter) {
  console.log(typeof kept, typeof value, counter, arguments.length);
  return kept + value;
}));
