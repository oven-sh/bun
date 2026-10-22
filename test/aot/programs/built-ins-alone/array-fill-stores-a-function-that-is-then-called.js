function work(value) {
  return value + 1;
}
console.log(new Array(2).fill(work)[1](1.5));
