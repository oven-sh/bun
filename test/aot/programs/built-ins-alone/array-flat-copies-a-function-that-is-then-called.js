function work(value) {
  return value + 1;
}
console.log([[work]].flat()[0](1.5));
