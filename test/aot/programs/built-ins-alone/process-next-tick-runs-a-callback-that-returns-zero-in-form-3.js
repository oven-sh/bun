function callback() {
  console.log("callback", arguments.length);
  return 0;
}
const result = process.nextTick(callback);
console.log(typeof result, result === undefined);
