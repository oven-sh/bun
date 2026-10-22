function target(first, second, third, fourth, fifth) {
  console.log(typeof first, first + 1);
}
target.apply(undefined, [0.5, 1, 2, 3, 4]);
