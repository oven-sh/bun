function work(value) {
  return value + 1;
}
console.log((await Promise.resolve(work))(1.5));
