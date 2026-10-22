function callback() {
  console.log("callback", this === undefined, arguments.length);
  return { made: 1.5 };
}
const result = queueMicrotask(callback);
console.log(typeof result, result === undefined);
