const data = JSON.parse('{ "first": 1, "second": 2 }', function (key, value) {
  if (key === "first") this.second = "changed";
  return value;
});
console.log(typeof data.second, data.second.length);
