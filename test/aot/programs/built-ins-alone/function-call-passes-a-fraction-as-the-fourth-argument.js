function target(first, second, third, fourth, fifth) {
  console.log(typeof fourth, fourth + 1);
}
target.call(undefined, 0, 1, 2, 3.5, 4);
