// A loose equality converts an object beside a primitive that is neither undefined nor null. What the conversion does is seen: it keeps the object, changes another, throws.
const kept = [];
let calls = 0;

function Vector(x, y) {
  this.x = x;
  this.y = y;
}
Vector.prototype.toString = function () {
  calls++;
  kept.push(this);
  return "[" + this.x + "," + this.y + "]";
};

class Amount {
  constructor(cents) {
    this.cents = cents;
    this.asked = 0;
  }
  valueOf() {
    this.asked++;
    return this.cents;
  }
}

class Guarded {
  constructor(secret) {
    this.secret = secret;
  }
  [Symbol.toPrimitive](hint) {
    if (this.secret === 3) throw new Error("no " + hint);
    return this.secret;
  }
}

function Node(value) {
  this.value = value;
  this.left = null;
  this.right = null;
  this.parent = null;
}
Node.prototype.toString = function () {
  calls += 1000;
  return "node " + this.value;
};

function insert(root, value) {
  let parent = null;
  let at = root;
  while (at) {
    parent = at;
    at = value < at.value ? at.left : at.right;
  }
  const made = new Node(value);
  made.parent = parent;
  if (!parent) return made;
  if (value < parent.value) parent.left = made;
  else parent.right = made;
  return root;
}

function isLeftChild(node) {
  return node.parent != null && node == node.parent.left;
}

function same(a, b) {
  return a == b;
}

let root = null;
for (const value of [5, 2, 8, 1, 9, 3, 7]) root = insert(root, value);
let lefts = 0;
(function visit(node) {
  if (node == null) return;
  if (isLeftChild(node)) lefts++;
  visit(node.left);
  visit(node.right);
})(root);
console.log(lefts, calls);

const values = [0, 1, -0, NaN, 3n, "", "[1,2]", "3", true, false, null, undefined, Symbol.iterator, "x"];
let yes = 0;
for (let i = 0; i < values.length * 3; i++) {
  const value = values[i % values.length];
  const objects = [new Vector(1, 2), new Amount(i % 5), new Guarded(i % 4)];
  for (const object of objects) {
    try {
      if (same(object, value)) yes++;
      if (same(value, object)) yes += 100;
      if (object != object) yes += 10000;
      if (same(object, objects[0])) yes += 100000;
    } catch (e) {
      yes += 1000000;
    }
  }
  if (objects[1].asked > 2) yes += 1e9;
}
console.log(yes, calls, kept.length, kept[0] === kept[1], kept.every(v => v.x === 1));
const first = new Vector(7, 8);
let mixed = first;
for (let i = 0; i < 6; i++) {
  if (mixed == (i & 1 ? "[7,8]" : first)) calls += 10000;
  mixed = i === 3 ? "[7,8]" : first;
}
kept[kept.length - 1].x = 70;
console.log(calls, first.x, String(first));
