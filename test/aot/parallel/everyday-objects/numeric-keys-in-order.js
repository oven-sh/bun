// The order of keys: numbers first, then texts as they came
function order(n) {
  const object = { b: 1, [n]: 2, a: 3, 1: 4 };
  object[n - 1] = 5;
  object["01"] = 6;
  object[-1] = 7;
  delete object.b;
  object.b = 8;
  const entries = Object.entries(object);
  return entries.map(([key, value]) => key + value).join() + " " + JSON.stringify(object).length + " " + entries.length;
}
console.log(order(5));
console.log(order(100));
console.log(order(2));
