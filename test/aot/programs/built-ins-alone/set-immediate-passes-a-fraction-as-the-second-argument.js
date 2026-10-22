function target(first, second, third, fourth, fifth) {
  console.log(typeof second, second + 1);
}
setImmediate(target, 0, 1.5, 2, 3, 4);
