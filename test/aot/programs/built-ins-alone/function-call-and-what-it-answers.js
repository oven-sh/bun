const subject = function work(first, second) {
  return second;
};
const result = subject.call(1.5, 2.5, "-");
console.log(typeof result, result.length, result);
