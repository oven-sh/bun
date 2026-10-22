const held = Object.values({ a: 1.5, b: 2.5 });
const view = new Float64Array(held);
console.log(view[0] + 1, view[1] + 1);
