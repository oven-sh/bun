function target(first, second, third, fourth, fifth) {
  console.log(typeof third, third + 1);
}
target.bind(undefined, 0).bind(null, 1, 2.5)(3, 4);
