const scale = { by: 2.5 };
const mapped = [1, 2].map(function (value) {
  return value * this.by;
}, scale);
console.log(mapped[0] + 1, mapped[1] + 1);
