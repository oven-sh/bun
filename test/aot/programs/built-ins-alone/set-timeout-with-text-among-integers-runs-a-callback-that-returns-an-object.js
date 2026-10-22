function callback() {
  console.log("callback", arguments.length);
  return { made: 1.5 };
}
const result = setTimeout(callback, 2, "text", 1.5);
console.log(typeof result, Object.keys(result).join());
