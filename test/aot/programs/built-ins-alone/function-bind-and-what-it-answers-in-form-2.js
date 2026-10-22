const subject = function work(first, second) {
  return second;
};
const result = subject.bind("an", 2.5, "-");
console.log(typeof result, result.length);
