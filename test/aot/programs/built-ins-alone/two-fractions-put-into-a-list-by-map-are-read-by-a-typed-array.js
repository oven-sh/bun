const held = [0, 1].map(index => (index === 0 ? 1.5 : 2.5));
const view = new Float64Array(held);
console.log(view[0] + 1, view[1] + 1);
