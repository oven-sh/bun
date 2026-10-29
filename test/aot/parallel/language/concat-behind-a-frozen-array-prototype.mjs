// Array.prototype.concat looks for the species of its receiver. Behind Object.freeze(Array.prototype) the engine asks the getter where it otherwise knows the answer.
Object.freeze(Array.prototype);
const holes = [1, , 3];
console.log([].concat(holes, [4]).length, [1].concat(2, [3]).join(), holes.slice(1).length, holes.filter(() => true).join(), holes.map(x => x).length);
