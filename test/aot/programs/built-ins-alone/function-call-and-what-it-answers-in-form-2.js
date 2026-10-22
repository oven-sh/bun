const subject = function work(first, second) {
  return second;
};
const result = subject.call("an", 2.5, "-");
console.log(typeof result, result.length, result);
