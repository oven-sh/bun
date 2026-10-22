function callback() {
  console.log("callback", arguments.length);
  return "text";
}
const result = process.nextTick(callback);
console.log(typeof result, result === undefined);
