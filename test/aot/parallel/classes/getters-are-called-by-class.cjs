// STATISTIC: GettersCalledByClass >= 1
// Under: --aot-harden=proof-checks: the getter that a class calls is the one that the object finds
// Under: --aot-testing=FailSpeculations: each read runs as written
// Under: --aot-testing=CheckEffectsAtRunTime: the tests of shapes write nothing and run no code of the program
// A name is a getter of each of the classes that an object may be of, few getters in all. Getters replaced, deleted, shadowed, thrown out of, traps, primitives and objects of other classes.
"use strict";
const Node = (() => {
  function Node() { this.parentNode = null; this._nextSibling = this._previousSibling = this; this._index = undefined; }
  Node.ELEMENT_NODE = 1;
  Node.TEXT_NODE = 3;
  Node.prototype = Object.create(Object.prototype, { isNode: { value: true } });
  return Node;
})();
class NodeList extends Array { constructor(a) { super((a && a.length) || 0); if (a) for (const i in a) this[i] = a[i]; } item(i) { return this[i] || null; } }
const ContainerNode = (() => {
  function ContainerNode() { Node.call(this); this._firstChild = this._childNodes = null; }
  ContainerNode.prototype = Object.create(Node.prototype, {
    hasChildNodes: { value: function () { if (this._childNodes) return this._childNodes.length > 0; return this._firstChild !== null; } },
    childNodes: { configurable: true, get: function () { this._ensureChildNodes(); return this._childNodes; } },
    _ensureChildNodes: { value: function () {
      if (this._childNodes) return;
      var first = this._firstChild, kid = first, childNodes = this._childNodes = new NodeList();
      if (first) do { childNodes.push(kid); kid = kid._nextSibling; } while (kid !== first);
      this._firstChild = null;
    } },
  });
  return ContainerNode;
})();
const Leaf = (() => {
  function Leaf() { Node.call(this); }
  Leaf.prototype = Object.create(Node.prototype, { hasChildNodes: { value: function () { return false; } }, childNodes: { configurable: true, get: function () { if (!this._childNodes) this._childNodes = new NodeList(); return this._childNodes; } } });
  return Leaf;
})();
const Text = (() => {
  function Text(data) { Leaf.call(this); this.nodeType = Node.TEXT_NODE; this._data = data; }
  Text.prototype = Object.create(Leaf.prototype, { nodeName: { value: "#text" } });
  return Text;
})();
function dataOf(node) { return node._data; }
const Element = (() => {
  function Element(doc, name) { ContainerNode.call(this); this.nodeType = Node.ELEMENT_NODE; this.ownerDocument = doc; this.localName = name; this._attrs = Object.create(null); }
  function recursiveGetText(node, a) {
    if (node.nodeType === Node.TEXT_NODE) {
      a.push(dataOf(node));
    } else {
      for (var i = 0, n = node.childNodes.length; i < n; i++)
        recursiveGetText(node.childNodes[i], a);
    }
  }
  Element.prototype = Object.create(ContainerNode.prototype, {
    textContent: { get: function () { var strings = []; recursiveGetText(this, strings); return strings.join(""); } },
  });
  Element.textOf = node => { var strings = []; recursiveGetText(node, strings); return strings.join("|"); };
  return Element;
})();
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
const HTMLElement = defineElement({ superclass: Element, name: "HTMLElement", ctor: function HTMLElement(doc, name) { Element.call(this, doc, name); }, props: { title: { get: function () { return this._attrs.title; } } } });
const define = spec => defineElement(spec, HTMLElement);
define({ tag: "div", name: "HTMLDivElement", ctor: function HTMLDivElement(doc, name) { HTMLElement.call(this, doc, name); } });
define({ tag: "span", name: "HTMLSpanElement", ctor: function HTMLSpanElement(doc, name) { HTMLElement.call(this, doc, name); } });
define({ tag: "a", name: "HTMLAnchorElement", ctor: function HTMLAnchorElement(doc, name) { HTMLElement.call(this, doc, name); }, props: { href: { get: function () { return this._attrs.href; } } } });
define({ tags: ["b", "i"], name: "HTMLElementOfText" });
function createElement(doc, name) { var impl = tagToImpl[name] || HTMLElement; return new impl(doc, name); }
function append(parent, kid) {
  kid.parentNode = parent;
  const first = parent._firstChild;
  if (!first) parent._firstChild = kid;
  else { const last = first._previousSibling; last._nextSibling = kid; kid._previousSibling = last; kid._nextSibling = first; first._previousSibling = kid; }
  return kid;
}
function makeTree(depth, width, at) {
  const top = createElement(null, names[(depth + at) % names.length]);
  if (depth === 0) { append(top, new Text("t" + at)); return top; }
  for (let i = 0; i < width; i++) { append(top, makeTree(depth - 1, width, at + i)); if (i & 1) append(top, new Text("x" + i)); }
  return top;
}
const names = ["div", "span", "a", "b", "other"], hidden = JSON.parse('"childNodes"'), lines = [], line = (...words) => lines.push(words.map(String).join(" "));
const attempt = f => { try { return f(); } catch (error) { return error.constructor.name; } };
let asked = 0;
const trees = [];
for (const [depth, width] of [[0, 1], [3, 2], [5, 2], [4, 3]]) { const tree = makeTree(depth, width, depth); trees.push(tree); line(depth, width, tree.textContent.length, Element.textOf(tree).length, tree.textContent.slice(0, 40)); }
let chain = createElement(null, "div");
append(chain, new Text("deep"));
for (let i = 0; i < 200; i++) { const up = createElement(null, names[i % 5]); append(up, chain); chain = up; }
let sum = 0;
for (let k = 0; k < 40; k++) sum += chain.textContent.length + trees[k & 3].textContent.length;
line("sum", sum, Element.textOf(chain));
const tree = trees[1], before = tree.textContent, parsed = text => JSON.parse(text);
const odd = [null, undefined, 5, "text", true, {}, parsed('{"childNodes":[]}'), parsed('{"childNodes":"abc"}'), parsed('{"childNodes":null}'), parsed('{"nodeType":1,"childNodes":[{"nodeType":3,"_data":7}]}'), [], Object.create(null), Object.create(tree), new Uint8Array(2), Object.defineProperty({}, hidden, { get() { asked += 1000; return []; } })];
for (const node of odd) line(attempt(() => Element.textOf(node)), asked);
line("proxy", attempt(() => Element.textOf(new Proxy(makeTree(2, 2, 1), { get: (t, k, r) => { asked++; return Reflect.get(t, k, r); } }))), asked);
line("above a proxy", attempt(() => Element.textOf(Object.create(new Proxy({}, { get: (t, k) => k === hidden ? [new Text("above")] : undefined })))));
Object.defineProperty(tree.childNodes[0], hidden, { configurable: true, value: [new Text("own value")] });
line(tree.textContent);
Object.defineProperty(tree.childNodes[0], hidden, { configurable: true, get() { asked++; return [new Text("own getter" + asked)]; } });
line(tree.textContent, tree.textContent);
Object.defineProperty(tree.childNodes[0], hidden, { configurable: true, set(v) { } });
line(attempt(() => tree.textContent));
delete tree.childNodes[0][hidden];
line(tree.textContent === before);
const original = Object.getOwnPropertyDescriptor(ContainerNode.prototype, hidden);
let left = 5;
Object.defineProperty(ContainerNode.prototype, hidden, { configurable: true, get() { if (left-- <= 0) throw new RangeError("left"); return original.get.call(this); } });
line(attempt(() => tree.textContent), left, attempt(() => chain.textContent));
Object.defineProperty(ContainerNode.prototype, hidden, { configurable: true, get() { return original.get.call(this).slice(0, 1); } });
line(attempt(() => makeTree(3, 2, 2).textContent), attempt(() => tree.textContent));
Object.defineProperty(ContainerNode.prototype, hidden, { configurable: true, value: [new Text("one for all")] });
line(attempt(() => makeTree(2, 2, 3).textContent), attempt(() => chain.textContent));
delete ContainerNode.prototype[hidden];
line(attempt(() => makeTree(2, 2, 4).textContent), attempt(() => chain.textContent));
Object.defineProperty(ContainerNode.prototype, hidden, original);
line(tree.textContent === before, chain.textContent);
const moved = createElement(null, "div");
append(moved, new Text("moved"));
line(moved.textContent);
Object.setPrototypeOf(moved, Leaf.prototype);
line(attempt(() => Element.textOf(moved)), moved.hasChildNodes());
const textsAbove = Object.getOwnPropertyDescriptor(Leaf.prototype, hidden);
Object.defineProperty(Leaf.prototype, hidden, { configurable: true, get() { asked += 7; return [new Text("from a leaf")]; } });
line(attempt(() => Element.textOf(moved)), tree.textContent === before, asked);
Object.defineProperty(Leaf.prototype, hidden, textsAbove);
let total = 0;
for (let k = 0; k < 400; k++) total += Element.textOf(trees[k & 3]).length + (k & 7 ? 0 : chain.textContent.length);
line("total", total, asked);
console.log(lines.join("\n"));
