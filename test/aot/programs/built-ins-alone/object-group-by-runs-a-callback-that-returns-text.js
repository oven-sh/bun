function callback(firstValue, secondValue) {
  console.log("callback", typeof firstValue, firstValue.length, firstValue, typeof secondValue, secondValue + 1);
  console.log(this === undefined, arguments.length);
  return "text";
}
const result = Object.groupBy("an", callback);
console.log(typeof result, Object.keys(result).join(), Array.isArray(result.text), result.text.length);
console.log(typeof result.text[0], result.text[0].length, result.text[0]);
console.log(typeof result.text[1], result.text[1].length, result.text[1]);
