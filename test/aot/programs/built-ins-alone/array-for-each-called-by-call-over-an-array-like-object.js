Array.prototype.forEach.call({ length: 2, 0: 1.5, 1: "two" }, (value, index) => {
  console.log(index, typeof value, value);
});
