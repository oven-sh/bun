const subject = new Uint8Array([1, 2, 3]);
function callback(firstValue, secondValue, thirdValue) {
  console.log("callback", typeof firstValue, firstValue + 1, typeof secondValue, secondValue + 1, thirdValue === subject);
  console.log(typeof this, arguments.length);
  return { made: 1.5 };
}
const result = subject.find(callback, 2.5);
console.log(typeof result, result + 1);
