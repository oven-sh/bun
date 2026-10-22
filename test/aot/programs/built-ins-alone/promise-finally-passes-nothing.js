await Promise.resolve(1.5).finally(function () {
  console.log(this === undefined, arguments.length);
});
