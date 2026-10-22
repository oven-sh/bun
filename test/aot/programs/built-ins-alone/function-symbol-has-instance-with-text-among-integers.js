const subject = function work(first, second) {
  return second;
};
const result = subject[Symbol.hasInstance]("text");
console.log(typeof result, result);
