const view = new Float32Array([1.5]);
const self = { name: 1 };
view.forEach(function (value, index, whole) {
  console.log(value + 1, index + 1, whole === view, this === self, arguments.length);
}, self);
