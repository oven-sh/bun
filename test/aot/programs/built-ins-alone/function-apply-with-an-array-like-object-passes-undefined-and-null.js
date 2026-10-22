function target(first, second, third, fourth, fifth) {
  console.log(first === undefined, typeof first);
  console.log(second === null, typeof second);
  console.log(third + 1, arguments.length);
}
target.apply(undefined, { length: 3, 0: undefined, 1: null, 2: 0.5 });
