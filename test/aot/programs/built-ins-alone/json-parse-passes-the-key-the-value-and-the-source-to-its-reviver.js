const data = JSON.parse('{ "first": 1.5, "list": ["two"] }', function (key, value, context) {
  console.log(typeof key, key, typeof value, typeof this, typeof context, arguments.length);
  return typeof value === "number" ? value * 2 : value;
});
console.log(data.first + 1, data.list[0].length);
