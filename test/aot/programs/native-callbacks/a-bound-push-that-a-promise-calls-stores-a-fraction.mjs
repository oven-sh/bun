// A promise hands what it holds to `push`, bound to a list of integers. A loop adds up what lies there.
const list = [1];
await Promise.resolve(1.5).then(list.push.bind(list));
let total = 0;
for (let turn = 0; turn < 100000; turn++) total += list[1] * 2;
console.log(total, list.length);
