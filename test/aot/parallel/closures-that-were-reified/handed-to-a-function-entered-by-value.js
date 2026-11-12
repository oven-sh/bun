const onRead = (value) => value + 5;
function apply(handler, value) {
  let work = 0;
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  return handler(value) + work;
}
const ways = [apply, apply];
let total = 0;
for (let turn = 0; turn < 300; turn++) total += ways[turn & 1](onRead, turn & 3);
console.log(total);
console.log(Object.getOwnPropertyNames(onRead).length, ways[total & 1](onRead, 1), apply(onRead, 2));
