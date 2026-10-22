const subject = new Uint8Array([1, 2, 3]);
function callback(firstValue, secondValue, thirdValue, fourthValue) {
  console.log("callback", typeof firstValue, firstValue, typeof secondValue, secondValue + 1, typeof thirdValue);
  console.log(thirdValue + 1, fourthValue === subject, this === undefined, arguments.length);
  return "text";
}
const result = subject.reduce(callback, 2.5);
console.log(typeof result, result.length, result);
