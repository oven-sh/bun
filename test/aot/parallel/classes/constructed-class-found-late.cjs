// STATISTIC: CallsInlined >= 18
// new (cached || (cached = find()))(..), where two classes are found.
function PlainNode(kind, flags) { this.kind = kind; this.flags = flags; this.parent = undefined; }
class NodeObject { constructor(kind, flags) { this.kind = kind; this.flags = flags; this.parent = undefined; } start() { return this.kind; } }
const allocator = { find: () => PlainNode };
let cached;
function createBase(kind) { return new (cached || (cached = allocator.find()))(kind, 1); }
function create(kind, parent) { const node = createBase(kind); node.parent = parent; return node; }
function depth(node) { let depth = 0; while (node) { depth += node.flags; node = node.parent; } return depth; }
function run(count) { let sum = 0; for (let i = 0; i < count; i++) { let node; for (let k = 0; k < 8; k++) node = create(k & 3, node); sum += depth(node) + node.kind; } return sum; }
console.log(run(100), create(1) instanceof PlainNode);
cached = undefined;
Object.assign(allocator, { find: () => NodeObject });
console.log(run(100), create(1) instanceof NodeObject);
