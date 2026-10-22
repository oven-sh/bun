function target(first, second, third, fourth, fifth) {
  console.log(typeof third, third + 1);
}
target.apply(undefined, { length: 5, 0: 0, 1: 1, 2: 2.5, 3: 3, 4: 4 });
