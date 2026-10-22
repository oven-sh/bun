function callback() {
  console.log("callback", arguments.length);
  return "text";
}
const result = process.nextTick(callback, 2.5, 2.5);
console.log(typeof result, result === undefined);
