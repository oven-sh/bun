// Species: proxy programs  a parameter brings numbers of every size into a field. It prints what plain Bun prints.
const log = [];
function Node1(tag, weight) { this.tag = tag; this.weight = weight; this.count = 0; }
class Node2 { constructor(tag, weight = 2147483648) { this.tag = tag; this.weight = weight; this.count = 0; } }
const made = [new Node1(1, 2), new Node1(2147483647, -2147483648), new Node2(3, 4), new Node2(5)];
made.push(Reflect.construct(Node1, [4294967296, 0.5]), new (Node1.bind(null, -0))(NaN), Reflect.construct(Node2, [1e21]), new Node2(...[7, -2147483649]));
Array.from({ length: 2 }, (_, i) => made.push(new Node1(i * 3e9, i - 0.25)));
const plain = {}; Node1.call(plain, "text", undefined); made.push(plain); Node1.apply(made[0], [Infinity, 1]);
for (const node of made) log.push(Object.is(node.tag, -0) ? "-0" : String(node.tag + 1), String(node.weight | 0), node.count);
console.log(log.join("; "));
