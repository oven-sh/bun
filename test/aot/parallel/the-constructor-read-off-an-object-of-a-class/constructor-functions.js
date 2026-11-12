// Constructor functions, one of whose prototypes has no constructor of its own until the middle of the loop.
function Tree() { this.k = 1; }
Tree.prototype.again = function () { return new this.constructor(); };
function Bush() { this.k = 20; }
Bush.prototype = Object.create(Tree.prototype);
const tree = new Tree(), bush = new Bush();
let sum = 0;
for (let i = 0; i < 300; i++) { if (i === 150) Bush.prototype.constructor = Bush; const from = i % 3 ? tree : bush; sum += from.again().k; }
console.log(sum);
