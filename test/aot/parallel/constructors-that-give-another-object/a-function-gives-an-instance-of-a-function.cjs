// The same of two constructor functions of a sloppy file, in a loop over a list that is made while the program runs.
function Leaf(text) { this.type = 'leaf'; this.text = text; }
function Branch(shape) {
  if (typeof shape === 'string') return new Leaf(shape);
  this.type = 'branch';
  this.parts = shape.map(function (part) { return new Branch(part); });
}
Branch.prototype.text = null;
function join(node) { return node.type === 'leaf' ? node.text : '(' + node.parts.map(join).join(' ') + ')'; }
console.log(join(new Branch(JSON.parse('["a",["b",["c"]],"d",[]]'))));
