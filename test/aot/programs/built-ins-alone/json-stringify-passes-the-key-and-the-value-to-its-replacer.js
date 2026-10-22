const holder = { first: 1.5, list: ["two"] };
console.log(JSON.stringify(holder, function (key, value) {
  console.log(typeof key, key, typeof value, this === holder, arguments.length);
  return typeof value === "number" ? `n${value}` : value;
}));
