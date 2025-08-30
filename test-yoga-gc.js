// Test script to force GC and see debug output
const Yoga = Bun.Yoga;

console.log("Creating yoga nodes...");

// Create some nodes
const nodes = [];
for (let i = 0; i < 5; i++) {
    const node = new Yoga.Node();
    node.setWidth(100 + i);
    node.setHeight(50 + i);
    nodes.push(node);
}

console.log("Created", nodes.length, "nodes");

// Force GC
console.log("Forcing garbage collection...");
Bun.gc(true);

console.log("GC forced, clearing references...");

// Clear references
nodes.length = 0;

console.log("Forcing GC again...");
Bun.gc(true);

console.log("Done");