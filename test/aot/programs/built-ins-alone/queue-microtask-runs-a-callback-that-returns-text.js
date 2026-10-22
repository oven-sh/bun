function callback() {
  console.log("callback", this === undefined, arguments.length);
  return "text";
}
const result = queueMicrotask(callback);
console.log(typeof result, result === undefined);
