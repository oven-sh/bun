function callback(firstValue, secondValue) {
  console.log("callback", typeof firstValue, firstValue.length, firstValue, typeof secondValue, secondValue + 1);
  console.log(this === undefined, arguments.length);
  return "text";
}
const result = Map.groupBy("an", callback);
console.log(result instanceof Map, result.size, Array.isArray(result.get("text")), result.get("text").length);
console.log(typeof result.get("text")[0], result.get("text")[0].length, result.get("text")[0]);
console.log(typeof result.get("text")[1], result.get("text")[1].length, result.get("text")[1], [...result.keys()].join());
