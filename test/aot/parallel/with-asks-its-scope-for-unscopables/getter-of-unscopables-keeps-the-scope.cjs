let kept;
function look() { with ({ x: 1, y: 2, get [Symbol.unscopables]() { kept = this; return undefined; } }) { return y; } }
const list = [];
for (let i = 0; i < 3; i++) list.push(look());
const first = kept;
for (let i = 0; i < 1000; i++) look();
console.log(list.join(), first.x, first.y, first === kept, Object.keys(first).join());
