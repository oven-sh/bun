const subject = new Uint8Array([1, 2, 3]);
function callback(firstValue, secondValue) {
  console.log("callback", typeof firstValue, firstValue + 1, typeof secondValue, secondValue + 1, this === undefined);
  console.log(arguments.length);
  return 0;
}
const result = subject.toSorted(callback);
console.log(result instanceof Uint8Array, result.length, typeof result[0], result[0] + 1);
console.log(typeof result[1], result[1] + 1);
