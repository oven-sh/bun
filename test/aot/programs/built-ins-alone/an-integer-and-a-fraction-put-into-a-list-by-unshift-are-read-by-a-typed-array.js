const held = [];
held.unshift(1.5);
held.unshift(7);
const view = new Float64Array(held);
console.log(view[0] + 1, view[1] + 1);
