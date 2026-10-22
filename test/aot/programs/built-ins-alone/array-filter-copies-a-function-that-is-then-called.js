function work(value) {
  return value + 1;
}
console.log([work].filter(Boolean)[0](1.5));
