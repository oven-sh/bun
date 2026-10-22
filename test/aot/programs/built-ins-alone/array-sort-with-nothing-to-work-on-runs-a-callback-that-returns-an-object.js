const list = [];
function callback() {
  console.log("callback", arguments.length);
  return { made: 1.5 };
}
const result = list.sort(callback);
console.log(result === list);
