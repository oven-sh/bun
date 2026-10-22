function work(value) {
  return value + 1;
}
console.log([work].entries().next().value[1](1.5));
