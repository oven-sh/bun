const subject = function work(first, second) {
  return second;
};
const result = subject[Symbol.hasInstance]("an");
console.log(typeof result, result);
