const map = new Map([["first", 1.5], [2, "two"]]);
const self = { name: 1 };
map.forEach(function (value, key, whole) {
  console.log(typeof value, typeof key, whole === map, this === self, arguments.length);
}, self);
