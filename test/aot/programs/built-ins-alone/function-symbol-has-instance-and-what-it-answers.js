const subject = function work(first, second) {
  return second;
};
const result = subject[Symbol.hasInstance](1.5);
console.log(typeof result, result);
