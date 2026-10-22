const subject = function work(first, second) {
  return second;
};
const result = subject.call("text", "text", 1.5);
console.log(typeof result, result + 1);
