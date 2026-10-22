// A tree of nodes whose links the constructor fills with null is walked by child, sibling and return, as a reconciler walks its fibers.
function Fiber(tag) { this.tag = tag; this.child = this.sibling = this.return = this.alternate = null; this.flags = 0; }
function grow(parent, depth) { let previous = null; for (let i = 0; i < 3 && depth > 0; i++) { const fiber = new Fiber(depth * 10 + i); fiber.return = parent; if (previous === null) parent.child = fiber; else previous.sibling = fiber; previous = fiber; grow(fiber, depth - 1); } return parent; }
function sum(root) { let node = root, total = 0; for (;;) { total += node.tag + node.flags; if (node.child !== null) { node = node.child; continue; } while (node.sibling === null) { if (node.return === null) return total; node = node.return; } node = node.sibling; } }
const root = grow(new Fiber(0), 6); let total = 0;
for (let round = 0; round < 50; round++) { total += sum(root); root.child.alternate = round & 1 ? root : null; root.flags = round; }
console.log(total, root.child.alternate === root, root.child.sibling.return === root);
