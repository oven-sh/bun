function work(value) {
  return value + 1;
}
console.log([work].splice(0, 1)[0](1.5));
