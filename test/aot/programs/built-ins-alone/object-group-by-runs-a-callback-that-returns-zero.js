function callback(firstValue, secondValue) {
  console.log("callback", typeof firstValue, firstValue.length, firstValue, typeof secondValue, secondValue + 1);
  console.log(this === undefined, arguments.length);
  return 0;
}
const result = Object.groupBy("an", callback);
console.log(typeof result, Object.keys(result).join(), Array.isArray(result[0]), result[0].length);
console.log(typeof result[0][0], result[0][0].length, result[0][0]);
console.log(typeof result[0][1], result[0][1].length, result[0][1]);
