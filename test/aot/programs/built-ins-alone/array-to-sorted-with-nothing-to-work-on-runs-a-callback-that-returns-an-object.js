const list = [];
function callback() {
  console.log("callback", arguments.length);
  return { made: 1.5 };
}
const result = list.toSorted(callback);
console.log(Array.isArray(result), result.length);
