await Promise.resolve({ size: 1.5 }).then(function (value) {
  console.log(typeof value, value.size + 1, this === undefined, arguments.length);
});
