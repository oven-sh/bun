function callback(firstValue, secondValue) {
  console.log("callback", typeof firstValue, firstValue.length, firstValue, typeof secondValue, secondValue + 1);
  console.log(this === undefined, arguments.length);
  return { made: 1.5 };
}
const result = Map.groupBy("text", callback);
console.log(result instanceof Map, result.size);
