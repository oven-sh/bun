const target = (first, second) => {
  console.log(typeof second, second + 1);
};
Reflect.apply(target, null, [1, 2.5]);
