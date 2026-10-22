function work(value) {
  return value + 1;
}
const key = {};
console.log(new WeakMap([[key, work]]).get(key)(1.5));
