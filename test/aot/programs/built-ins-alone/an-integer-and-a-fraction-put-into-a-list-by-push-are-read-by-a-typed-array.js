const held = [];
held.push(7);
held.push(1.5);
const view = new Float64Array(held);
console.log(view[0] + 1, view[1] + 1);
