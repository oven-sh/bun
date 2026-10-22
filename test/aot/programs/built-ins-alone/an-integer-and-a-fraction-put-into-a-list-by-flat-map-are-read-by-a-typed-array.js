const held = [0].flatMap(() => [7, 1.5]);
const view = new Float64Array(held);
console.log(view[0] + 1, view[1] + 1);
