function work(value) {
  return value + 1;
}
console.log([].concat([work])[0](1.5), [].concat(work)[0](2.5));
