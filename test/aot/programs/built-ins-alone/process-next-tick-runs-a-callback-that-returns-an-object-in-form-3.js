function callback() {
  console.log("callback", arguments.length);
  return { made: 1.5 };
}
const result = process.nextTick(callback);
console.log(typeof result, result === undefined);
