const held = [new Promise(resolve => resolve(1.5)), new Promise(resolve => resolve(2.5))];
const list = await Promise.all(held);
console.log(list.length);
console.log(list[0] + 1, list[1] + 1);
