function work(value) {
  return value + 1;
}
console.log(Array.from([work])[0](1.5));
