const subject = new Uint8Array([1, 2, 3]);
function callback(firstValue, secondValue) {
  console.log("callback", typeof firstValue, firstValue + 1, typeof secondValue, secondValue + 1, this === undefined);
  console.log(arguments.length);
  return "text";
}
const result = subject.sort(callback);
console.log(result === subject);
