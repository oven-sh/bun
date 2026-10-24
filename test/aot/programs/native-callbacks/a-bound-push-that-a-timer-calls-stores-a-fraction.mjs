// A timer calls `push`, bound to a list of integers, with the argument that it was given. A loop adds up what lies there.
const list = [1];
await new Promise(resolve => {
  setTimeout(list.push.bind(list), 0, 1.5);
  setTimeout(resolve, 2);
});
let total = 0;
for (let turn = 0; turn < 100000; turn++) total += list[1] * 2;
console.log(total, list.length);
