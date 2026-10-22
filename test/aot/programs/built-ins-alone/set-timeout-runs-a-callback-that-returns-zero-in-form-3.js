function callback() {
  console.log("callback", arguments.length);
  return 0;
}
const result = setTimeout(callback, 2.5, 3.5, "x");
console.log(typeof result, Object.keys(result).join());
