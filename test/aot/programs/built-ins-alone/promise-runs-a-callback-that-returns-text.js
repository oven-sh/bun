function callback(firstValue, secondValue) {
  console.log("callback", typeof firstValue, typeof secondValue, this === undefined, arguments.length);
  return "text";
}
const result = new Promise(callback);
console.log(result instanceof Promise);
