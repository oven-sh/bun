function f(array) {
  let total = 0;
  for (let i = 0; i < array.length; i++) total += array[i].v;
  const child = { __proto__: array, own: 1 };
  for (let i = 0; i < array.length; i++) total += array[i].v * 100;
  return total + child[1].v + child.own;
}
let sum = 0;
for (let i = 0; i < 100; i++) sum += f(Object.freeze([{ v: i }, { v: i + 1 }]));
console.log(sum);
