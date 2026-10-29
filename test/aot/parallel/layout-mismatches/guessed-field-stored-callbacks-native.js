// forEach, sort, a reviver of JSON.parse, a replacer of replace and a reaction of a promise store into a field that the constructor fills with null.
const log = [];
function Node1(v) { this.value = v; this.next = null; }
const nodes = [new Node1(3), new Node1(1), new Node1(2)];
nodes.forEach((node, index, all) => { node.next = all[index + 1] ?? index; });
nodes.sort((x, y) => { x.next = y.value > 1 ? y : "small"; return x.value - y.value; });
JSON.parse('{"a":1}', function (key, value) { if (key === "a") nodes[0].next = this; return value; });
"xy".replace(/x/, match => { nodes[1].next = match; return match; });
Promise.resolve(nodes[2]).then(node => { node.next = new Error("late"); log.push(node.next.message); console.log(log.join("; ")); });
log.push(typeof nodes[0].next, nodes[0].next.a, nodes[1].next, typeof nodes[2].next);
