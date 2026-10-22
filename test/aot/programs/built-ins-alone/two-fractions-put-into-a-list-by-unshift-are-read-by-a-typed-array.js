const held = [];
held.unshift(2.5);
held.unshift(1.5);
const view = new Float64Array(held);
console.log(view[0] + 1, view[1] + 1);
