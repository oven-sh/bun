const target = (first, second) => {
  console.log(typeof second, second + 1);
};
target.bind(null, 1, 2.5)();
