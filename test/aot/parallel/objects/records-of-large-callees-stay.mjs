// Loops inside loops run functions that make a record of one field for a callee of many operations: a copy of it would cost more than the record. Few operations for each field pay.
// STATISTIC: CallsInlined <= 11
function describe({ node }) {
  if (!node) throw new Error("no node");
  let text = node.type;
  if (node.name) text += ":" + node.name;
  if (node.value !== undefined) text += "=" + node.value;
  if (node.left) text += "<" + node.left.type;
  if (node.right) text += ">" + node.right.type;
  return text.length + (node.start | 0) + (node.end | 0);
}
function place({ node, parent, key, list, index }) { return node && parent && list[index] === node ? key : undefined; }
class Visitor {
  constructor() { this.total = 0; this.keys = []; }
  visitAll(lists) { for (const list of lists) this.visitList(list); return this.total; }
  visitList(list) { for (let i = 0; i < list.length; i++) { this.enter(list[i], list, i); } }
  enter(node, list, index) { this.count(node); this.keep(node, list, index); }
  count(node) { this.total += describe({ node }); return this; }
  keep(node, list, index) { const key = place({ node, parent: this, key: index, list, index }); if (key !== undefined) this.keys.push(key); return key; }
}
const visitor = new Visitor();
const lists = Array.from({ length: 6 }, (_, i) => Array.from({ length: i + 2 }, (_, j) => ({ type: j % 2 ? "Name" : "Number", name: j % 2 ? "n" + j : undefined, value: j % 2 ? undefined : j, left: j ? { type: "L" } : null, right: i ? { type: "R" } : null, start: i, end: j })));
console.log(visitor.visitAll(lists), visitor.keys.join(""));
for (const wrong of [undefined, null, {}, { node: null }, 5]) { try { console.log(describe(wrong)); } catch (error) { console.log(error.constructor.name, error.message); } }
try { visitor.visitList([null]); } catch (error) { console.log(error.message); }
console.log(place({ list: [] }), place({ node: 1, parent: 2, key: 3, list: [1], index: 0 }));
