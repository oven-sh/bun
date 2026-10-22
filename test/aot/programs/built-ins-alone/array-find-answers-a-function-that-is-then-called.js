function work(value) {
  return value + 1;
}
console.log([work].find(each => each.length === 1)(1.5));
