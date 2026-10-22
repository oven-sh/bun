const target = (first, second) => {
  console.log(typeof second, second + 1);
};
target.apply(null, [1, 2.5]);
