const subject = new Headers({ first: "1", second: "two" });
function callback(firstValue, secondValue, thirdValue) {
  console.log("callback", typeof firstValue, firstValue.length, firstValue, typeof secondValue, secondValue.length);
  console.log(secondValue, thirdValue === subject, typeof this, arguments.length);
  return "text";
}
const result = subject.forEach(callback, 2.5);
console.log(typeof result, result === undefined);
