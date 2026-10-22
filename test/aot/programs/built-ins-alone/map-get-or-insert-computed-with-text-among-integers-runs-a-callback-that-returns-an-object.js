const map = new Map([["first", 1], ["second", 2]]);
function callback() {
  console.log("callback", arguments.length);
  return { made: 1.5 };
}
const result = map.getOrInsertComputed("second", callback);
console.log(typeof result, result + 1);
