const map = new Map();
function callback(firstValue) {
  console.log("callback", typeof firstValue, firstValue.length, firstValue, this === undefined, arguments.length);
  return { made: 1.5 };
}
const result = map.getOrInsertComputed("second", callback);
console.log(typeof result, Object.keys(result).join(), typeof result.made, result.made + 1, map instanceof Map);
console.log(map.size, typeof map.get("second"), Object.keys(map.get("second")).join(), typeof map.get("second").made, map.get("second").made + 1);
console.log([...map.keys()].join());
