function callback() {
  console.log("callback", this === undefined, arguments.length);
  return 0;
}
const result = queueMicrotask(callback);
console.log(typeof result, result === undefined);
