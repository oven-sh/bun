const held = Object.values({ a: 1.5, b: 2.5 });
const list = [held].flat();
console.log(list.length);
console.log(list[0] + 1, list[1] + 1);
