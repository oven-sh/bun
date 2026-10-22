function work(value) {
  return value + 1;
}
console.log(new Set([work]).values().next().value(1.5));
