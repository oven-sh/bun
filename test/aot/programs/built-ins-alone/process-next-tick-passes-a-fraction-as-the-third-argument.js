function target(first, second, third, fourth, fifth) {
  console.log(typeof third, third + 1);
}
process.nextTick(target, 0, 1, 2.5, 3, 4);
