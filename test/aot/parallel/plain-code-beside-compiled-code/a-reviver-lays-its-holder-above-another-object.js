const below = [];
const parsed = JSON.parse('{"a":1,"b":2,"c":3}', function (key, value) {
  if (key === "a") below.push(Object.create(this));
  return typeof value === "number" ? value * 10 : value;
});
console.log(JSON.stringify(parsed), below[0].a, below[0].b, below[0].c);
