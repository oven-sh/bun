function callback(firstValue, secondValue) {
  console.log("callback", typeof firstValue, typeof secondValue, this === undefined, arguments.length);
  return { made: 1.5 };
}
const result = new Promise(callback);
console.log(result instanceof Promise);
