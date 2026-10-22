const list = [1, 2, 3];
function callback(firstValue, secondValue) {
  console.log("callback", typeof firstValue, firstValue + 1, typeof secondValue, secondValue + 1, this === undefined);
  console.log(arguments.length);
  return { made: 1.5 };
}
const result = list.sort(callback);
console.log(result === list);
