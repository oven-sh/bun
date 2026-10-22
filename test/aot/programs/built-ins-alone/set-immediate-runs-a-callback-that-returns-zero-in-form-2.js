function callback() {
  console.log("callback", arguments.length);
  return 0;
}
const result = setImmediate(callback, 2.5, 2.5);
console.log(typeof result, Object.keys(result).join());
