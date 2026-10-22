const list = [1, 2, 3];
function callback(firstValue, secondValue) {
  console.log("callback", typeof firstValue, firstValue + 1, typeof secondValue, secondValue + 1, this === undefined);
  console.log(arguments.length);
  return { made: 1.5 };
}
const result = list.toSorted(callback);
console.log(Array.isArray(result), result.length, typeof result[0], result[0] + 1);
console.log(typeof result[1], result[1] + 1, typeof result[2], result[2] + 1);
