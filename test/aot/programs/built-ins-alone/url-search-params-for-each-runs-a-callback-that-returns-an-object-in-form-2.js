const subject = new URLSearchParams("first=1&second=two&first=3");
function callback(firstValue, secondValue, thirdValue) {
  console.log("callback", typeof firstValue, firstValue.length, firstValue, typeof secondValue, secondValue.length);
  console.log(secondValue, thirdValue === subject, typeof this, arguments.length);
  return { made: 1.5 };
}
const result = subject.forEach(callback, 2.5);
console.log(typeof result, result === undefined);
