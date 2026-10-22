function work(value) {
  return value + 1;
}
console.log([work].reduce((kept, each) => each)(1.5));
