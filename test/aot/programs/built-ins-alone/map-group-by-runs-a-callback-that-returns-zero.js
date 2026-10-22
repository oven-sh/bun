function callback(firstValue, secondValue) {
  console.log("callback", typeof firstValue, firstValue.length, firstValue, typeof secondValue, secondValue + 1);
  console.log(this === undefined, arguments.length);
  return 0;
}
const result = Map.groupBy("an", callback);
console.log(result instanceof Map, result.size, Array.isArray(result.get(0)), result.get(0).length);
console.log(typeof result.get(0)[0], result.get(0)[0].length, result.get(0)[0]);
console.log(typeof result.get(0)[1], result.get(0)[1].length, result.get(0)[1], [...result.keys()].join());
