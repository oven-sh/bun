function callback() {
  console.log("callback", arguments.length);
  return 0;
}
const result = process.nextTick(callback, 2.5, 2.5);
console.log(typeof result, result === undefined);
