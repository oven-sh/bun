const promise = new Promise(function (resolve, reject) {
  console.log(typeof resolve, typeof reject, resolve.length, this === undefined, arguments.length);
  resolve(1.5);
  resolve("ignored");
  reject("ignored");
});
console.log((await promise) + 1);
