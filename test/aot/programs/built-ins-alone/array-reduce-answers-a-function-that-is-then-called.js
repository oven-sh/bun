function work(value) {
  return value + 1;
}
console.log([work].reduce((kept, each) => each, null)(1.5));
