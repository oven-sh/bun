const scale = { by: 2.5 };
const list = Array.from(["a", "b"], function (value, index) {
  console.log(typeof value, index + 1, this === scale, arguments.length);
  return index * this.by;
}, scale);
console.log(list[1] + 1);
