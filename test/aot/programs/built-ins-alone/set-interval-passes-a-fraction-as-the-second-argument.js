function target(first, second, third, fourth, fifth) {
  console.log(typeof second, second + 1);
  clearInterval(this);
}
setInterval(target, 1, 0, 1.5, 2, 3, 4);
