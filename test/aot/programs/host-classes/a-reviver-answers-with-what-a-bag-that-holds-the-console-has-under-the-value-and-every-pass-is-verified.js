// A reviver looks its value up in an object that holds the console, so the console may be what JSON.parse answers with.
const bag = { target: console };
const found = JSON.parse("1", function (key, value) {
  return bag[value];
});
const named = JSON.parse('"target"', function (key, value) {
  return bag[value];
});
console.log(typeof found, typeof named, named === console);
