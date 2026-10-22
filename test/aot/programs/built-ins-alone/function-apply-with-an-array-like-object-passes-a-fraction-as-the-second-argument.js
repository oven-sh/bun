function target(first, second, third, fourth, fifth) {
  console.log(typeof second, second + 1);
}
target.apply(undefined, { length: 5, 0: 0, 1: 1.5, 2: 2, 3: 3, 4: 4 });
