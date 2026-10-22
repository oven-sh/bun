function callback() {
  console.log("callback", arguments.length);
  return { made: 1.5 };
}
const result = setImmediate(callback, 2.5, 2.5);
console.log(typeof result, Object.keys(result).join());
