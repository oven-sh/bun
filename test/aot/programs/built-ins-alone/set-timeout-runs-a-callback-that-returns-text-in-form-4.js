function callback() {
  console.log("callback", arguments.length);
  return "text";
}
const result = setTimeout(callback, 2.5, "x", "x");
console.log(typeof result, Object.keys(result).join());
