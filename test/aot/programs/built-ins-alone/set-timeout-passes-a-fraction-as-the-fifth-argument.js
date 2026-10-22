function target(first, second, third, fourth, fifth) {
  console.log(typeof fifth, fifth + 1);
}
setTimeout(target, 0, 0, 1, 2, 3, 4.5);
