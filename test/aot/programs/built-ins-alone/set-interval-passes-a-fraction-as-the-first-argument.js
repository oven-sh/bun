function target(first, second, third, fourth, fifth) {
  console.log(typeof first, first + 1);
  clearInterval(this);
}
setInterval(target, 1, 0.5, 1, 2, 3, 4);
