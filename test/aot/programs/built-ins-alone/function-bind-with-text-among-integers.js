const subject = function work(first, second) {
  return second;
};
const result = subject.bind("text", "text", 1.5);
console.log(typeof result, result.length);
