// A store into an object that may be of a constructor function whose first object is not made yet: under proof checks the guard of that function was asked alone.
function attempt(f) { try { return f(); } catch (e) { return e.name; } }
class Node { constructor(key) { } }
const kinds = { Node };
function Other(key) { this.key = key; }
let root = null; let last = { key: -1 };
function store(key) { const node = key & 3 ? new kinds.Node(key) : last; if (root && root.key > key) { } else { node.more = "s" + key; node.extra = root; } }
function replace(key) { const node = new kinds.Node(key); last = node; missing.push(node); }
function run(from, to) { for (let key = from; key < to; key++) { store(key); replace(key); } }
console.log(attempt(() => run(0, 60)));
console.log(Object.keys(last).length);
kinds.Node = Other;
console.log(attempt(() => run(1, 2)), attempt(() => run(0, 1)));
console.log(JSON.stringify(last));
