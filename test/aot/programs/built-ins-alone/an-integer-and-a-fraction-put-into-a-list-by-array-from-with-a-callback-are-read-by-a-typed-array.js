const held = Array.from({ length: 2 }, (value, index) => (index === 0 ? 7 : 1.5));
const view = new Float64Array(held);
console.log(view[0] + 1, view[1] + 1);
