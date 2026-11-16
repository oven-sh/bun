// STATISTIC: MethodsExpectedByDescriptors >= 2
// Under: --aot-harden=proof-checks: the nodes are of the classes that the walker expects
// Under: --aot-testing=FailSpeculations: each read runs as written
// Under: --aot-testing=CheckEffectsAtRunTime: the tests of shapes write nothing and run no code of the program
// A walker of trees reads one name off the leaves alone, so that only their classes have every name that it uses. It expects every node of the tree.
"use strict";
// The key of what the program defines later.
const hidden = JSON.parse('"childNodes"');
const lines = [], line = text => lines.push(text);
const attempt = f => { try { return f(); } catch (error) { return error.constructor.name; } };
function Node() { this.parentNode = null; this._nextSibling = this._previousSibling = this; this._index = undefined; }
Node.ELEMENT_NODE = 1;
Node.TEXT_NODE = 3;
Node.prototype = Object.create(Object.prototype, { isNode: { value: true } });
class NodeList extends Array { constructor(a) { super((a && a.length) || 0); } item(i) { return this[i] || null; } }
let made = 0, asked = 0;
function ContainerNode() { Node.call(this); this._firstChild = this._childNodes = null; }
ContainerNode.prototype = Object.create(Node.prototype, {
  childNodes: { configurable: true, get: function () { this._ensureChildNodes(); return this._childNodes; } },
  kids: { configurable: true, get() { asked++; return this._childNodes || (this._ensureChildNodes(), this._childNodes); } },
  _ensureChildNodes: { value: function () {
    if (this._childNodes) return;
    made++;
    var first = this._firstChild, kid = first, childNodes = this._childNodes = new NodeList();
    if (first) do { childNodes.push(kid); kid = kid._nextSibling; } while (kid !== first);
    this._firstChild = null;
  } },
});
function Leaf() { Node.call(this); }
Leaf.prototype = Object.create(Node.prototype, {
  childNodes: { configurable: true, get: function () { if (!this._childNodes) this._childNodes = new NodeList(); return this._childNodes; } },
  kids: { configurable: true, get() { asked += 100; return []; } },
});
function Text(data) { Leaf.call(this); this.nodeType = Node.TEXT_NODE; this._data = data; }
Text.prototype = Object.create(Leaf.prototype, { nodeName: { value: "#text" } });
function Comment(data) { Leaf.call(this); this.nodeType = 8; this._data = data; }
Comment.prototype = Object.create(Leaf.prototype, { nodeName: { value: "#comment" } });
function Element(doc, name) { ContainerNode.call(this); this.nodeType = Node.ELEMENT_NODE; this.ownerDocument = doc; this.localName = name; }
function recursiveGetText(node, a) {
  if (node.nodeType === Node.TEXT_NODE) {
    a.push(node._data);
  } else {
    for (var i = 0, n = node.childNodes.length; i < n; i++)
      recursiveGetText(node.childNodes[i], a);
  }
}
function count(node, kinds) {
  kinds[node.nodeType] = (kinds[node.nodeType] || 0) + 1;
  for (const kid of node.childNodes.values()) count(kid, kinds);
  return kinds;
}
function textOf(node, out) { if (node.nodeType === 3) { out.push(node._data); } else { for (const kid of node.childNodes) textOf(kid, out); } return out; }
function deepest(node) { if (node.nodeType === 3) return node._data.length; let most = 0; for (let i = 0; i < node.kids.length; i++) { const d = deepest(node.kids[i]); if (d > most) most = d; } return most + 1; }
function depthOf(node) { let deepest = 0; for (let i = 0; i < node.kids.length; i++) { const d = depthOf(node.kids[i]); if (d > deepest) deepest = d; } return deepest + 1; }
function firstOf(node) { return node.childNodes[0]; }
function lengthOf(node) { return node.childNodes.length; }
Element.prototype = Object.create(ContainerNode.prototype, {
  textContent: { get: function () { var strings = []; recursiveGetText(this, strings); return strings.join(""); } },
});
const tagToImpl = Object.create(null), list = {};
function defineElement(spec, base) {
  var c = spec.ctor;
  if (c) {
    var props = spec.props || {};
    props.constructor = { value: c, writable: true };
    c.prototype = Object.create((spec.superclass || base).prototype, props);
    list[spec.name] = c;
  } else c = base;
  (spec.tags || (spec.tag && [spec.tag]) || []).forEach(function (tag) { tagToImpl[tag] = c; });
  return c;
}
const HTMLElement = defineElement({ superclass: Element, name: "HTMLElement", ctor: function HTMLElement(doc, name) { Element.call(this, doc, name); } });
const define = spec => defineElement(spec, HTMLElement);
for (const tag of ["div", "span", "p"]) define({ tag, name: "HTML" + tag, ctor: function (doc, name) { HTMLElement.call(this, doc, name); } });
define({ tags: ["b", "i"], name: "HTMLOther" });
function createElement(name) { var impl = tagToImpl[name] || HTMLElement; return new impl(null, name); }
function append(parent, kid) {
  kid.parentNode = parent;
  const first = parent._firstChild;
  if (!first) parent._firstChild = kid;
  else { const last = first._previousSibling; last._nextSibling = kid; kid._previousSibling = last; kid._nextSibling = first; first._previousSibling = kid; }
  return kid;
}
function makeTree(depth, width, names) {
  const top = createElement(names[0]);
  if (depth === 0) { append(top, new Text("t" + width)); return top; }
  for (let i = 0; i < width; i++) {
    append(top, makeTree(depth - 1, width, names.slice(1).concat(names[0])));
    append(top, i & 1 ? new Text("x" + i) : new Comment("c" + i));
  }
  return top;
}
const names = ["div", "span", "p", "b", "other"];
for (const [depth, width] of [[0, 1], [3, 2], [5, 2], [4, 3]]) {
  const tree = makeTree(depth, width, names), kinds = count(tree, {});
  line([depth, width, tree.textContent.replace(/c\d/g, "").length, tree.textContent.length, JSON.stringify(kinds), depthOf(tree), lengthOf(tree), firstOf(tree).nodeType, made, asked].join(" "));
}
const deep = createElement("div");
{ let at = deep; for (let i = 0; i < 300; i++) at = append(at, createElement(i % 3 ? "div" : "span")); append(at, new Text("deep")); }
let sum = 0;
for (let k = 0; k < 40; k++) for (let n = deep; n.nodeType === 1; n = n.childNodes[0]) sum += n.textContent.length;
line("deep " + sum + " " + depthOf(deep) + " " + made + " " + asked);
// objects that are no nodes
const odd = [null, undefined, 5, "text", true, Symbol.iterator, {}, { childNodes: [] }, { childNodes: "abc" }, { childNodes: null }, { nodeType: 1, childNodes: [new Text("in"), { nodeType: 3, _data: 7 }] }, [], () => 1, Object.create(null), Object.create(deep), new Uint8Array(2), { get childNodes() { asked += 1000; return [1, 2]; } }];
for (const node of odd) line([attempt(() => textOf(node, []).join()), attempt(() => deepest(node)), attempt(() => lengthOf(node)), attempt(() => String(typeof firstOf(node))), attempt(() => { const out = []; recursiveGetText(node, out); return out.join("|"); }), attempt(() => depthOf(node)), asked].join());
const trapped = new Proxy(makeTree(2, 2, names), { get: (t, k, r) => { asked++; return Reflect.get(t, k, r); } });
line([lengthOf(trapped), attempt(() => { const out = []; recursiveGetText(trapped, out); return out.join("|"); }), depthOf(trapped), asked].join());
const aboveTrapped = Object.create(new Proxy({}, { get: (t, k, r) => k === "childNodes" ? [new Text("above")] : k === "kids" ? [] : undefined }));
line([lengthOf(aboveTrapped), depthOf(aboveTrapped), attempt(() => { const out = []; recursiveGetText(aboveTrapped, out); return out.join("|"); })].join());
// shadowed, replaced, thrown out of
const tree = makeTree(3, 2, names);
const before = tree.textContent;
Object.defineProperty(tree.childNodes[0], hidden, { configurable: true, value: [new Text("own value")] });
line(tree.textContent + " " + lengthOf(tree.childNodes[0]) + " " + depthOf(tree));
Object.defineProperty(tree.childNodes[0], hidden, { configurable: true, get() { asked++; return [new Text("own getter" + asked)]; } });
line(tree.textContent + " " + lengthOf(tree.childNodes[0]));
Object.defineProperty(tree.childNodes[0], hidden, { configurable: true, set(v) { } });
line(String(attempt(() => tree.textContent)) + " " + attempt(() => lengthOf(tree.childNodes[0])));
delete tree.childNodes[0][hidden];
line(String(tree.textContent === before) + " " + lengthOf(tree.childNodes[0]));
let left = 5;
const original = Object.getOwnPropertyDescriptor(ContainerNode.prototype, hidden);
Object.defineProperty(ContainerNode.prototype, hidden, { configurable: true, get() { if (left-- <= 0) throw new RangeError("left"); return original.get.call(this); } });
line([attempt(() => tree.textContent), left, attempt(() => lengthOf(deep)), left].join());
Object.defineProperty(ContainerNode.prototype, hidden, { configurable: true, get() { const kids = original.get.call(this); if (kids.length > 1) kids.length--; return kids; } });
line([attempt(() => makeTree(3, 2, names).textContent), attempt(() => lengthOf(makeTree(1, 3, names)))].join());
Object.defineProperty(ContainerNode.prototype, hidden, { configurable: true, value: [new Text("one for all")] });
line([attempt(() => makeTree(2, 2, names).textContent), attempt(() => lengthOf(deep))].join());
delete ContainerNode.prototype[hidden];
line([attempt(() => makeTree(2, 2, names).textContent), attempt(() => lengthOf(deep))].join());
Object.defineProperty(ContainerNode.prototype, hidden, original);
line([tree.textContent === before, lengthOf(tree), depthOf(deep), textOf(tree, []).join(), deepest(tree), textOf(deep, []).join(), deepest(deep)].join());
const moved = createElement("div");
append(moved, new Text("moved"));
Object.setPrototypeOf(moved, Leaf.prototype);
line([attempt(() => lengthOf(moved)), attempt(() => { const out = []; recursiveGetText(moved, out); return out.length; })].join());
class Declared { get childNodes() { return [new Text("declared")]; } get kids() { return [this.next, this.next].filter(Boolean); } nodeType = 1; next = null; }
const declared = new Declared();
declared.next = new Declared();
line([lengthOf(declared), depthOf(declared), attempt(() => { const out = []; recursiveGetText(declared, out); return out.join(); })].join());
let total = 0;
for (let k = 0; k < 2000; k++) total += lengthOf(k & 1 ? deep : k & 2 ? tree : declared) + depthOf(k & 4 ? declared : firstOf(deep).parentNode === deep ? declared : tree);
line("total " + total + " " + made + " " + asked);
console.log(lines.join("\n"));
