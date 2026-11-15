// STATISTIC: TreeNodesExpected >= 2
// COUNTER: ClassGuardBitsInvalidated >= 1
// Under: --aot-harden=proof-checks: a member that an heir overrides is no member of the class
// Under: --aot-testing=FailSpeculations: each read runs as written
// Constructor functions that a helper lays below a class override some of its members: the others are the members of the class for their objects too. Members overridden before and behind the first object, replaced, deleted, hidden by one object, prototype objects given another prototype.
"use strict";
const lines = [], line = (...words) => lines.push(words.map(String).join(" "));
const attempt = f => { try { return f(); } catch (error) { return error.constructor.name; } };
const hidden = JSON.parse('["childNodes","kind","innerHTML","serialize","depth"]');
const Node = (() => {
  function Node() { this.parentNode = null; this._nextSibling = this._previousSibling = this; this._index = undefined; }
  Node.TEXT_NODE = 3;
  Node.prototype = Object.create(Object.prototype, { isNode: { value: true }, childNodes: { configurable: true, get: function () { throw new Error("to be overridden"); } } });
  return Node;
})();
class NodeList extends Array { constructor(a) { super((a && a.length) || 0); } item(i) { return this[i] || null; } }
const ContainerNode = (() => {
  function ContainerNode() { Node.call(this); this._firstChild = this._childNodes = null; }
  ContainerNode.prototype = Object.create(Node.prototype, {
    childNodes: { configurable: true, get: function () { this._ensureChildNodes(); return this._childNodes; } },
    _ensureChildNodes: { configurable: true, value: function () {
      if (this._childNodes) return;
      var first = this._firstChild, kid = first, childNodes = this._childNodes = new NodeList();
      if (first) do { childNodes.push(kid); kid = kid._nextSibling; } while (kid !== first);
      this._firstChild = null;
    } },
  });
  return ContainerNode;
})();
const Text = (() => {
  function Text(data) { Node.call(this); this.nodeType = Node.TEXT_NODE; this._data = data; this._childNodes = new NodeList(); }
  Text.prototype = Object.create(Node.prototype, { childNodes: { configurable: true, get: function () { return this._childNodes; } }, kind: { configurable: true, value: function () { return "text"; } } });
  return Text;
})();
const Element = (() => {
  function Element(doc, name) { ContainerNode.call(this); this.nodeType = 1; this.ownerDocument = doc; this.localName = name; }
  Element.prototype = Object.create(ContainerNode.prototype, {
    innerHTML: { configurable: true, get: function () { return "outer " + this.localName; }, set: function (text) { this.localName = text; } },
    serialize: { configurable: true, writable: true, value: function (deep) { return "<" + this.localName + (deep ? ">" : "/>"); } },
    kind: { configurable: true, writable: true, value: function () { return "element"; } },
    depth: { configurable: true, get: function () { var d = 0; for (var n = this; n; n = n.parentNode) d++; return d; } },
  });
  return Element;
})();
const impls = Object.create(null);
function define(spec, base) {
  const c = spec.ctor, props = spec.props || {};
  props.constructor = { value: c, writable: true };
  c.prototype = Object.create((spec.superclass || base).prototype, props);
  for (const tag of spec.tags) impls[tag] = c;
  return c;
}
const HTMLElement = define({ superclass: Element, tags: [], ctor: function HTMLElement(doc, name) { Element.call(this, doc, name); }, props: { innerHTML: { configurable: true, get: function () { return "inner " + this.localName; }, set: function (text) { this.localName = text + "!"; } } } });
const Div = define({ tags: ["div"], ctor: function HTMLDivElement(doc, name) { HTMLElement.call(this, doc, name); } }, HTMLElement);
define({ tags: ["span"], ctor: function HTMLSpanElement(doc, name) { HTMLElement.call(this, doc, name); }, props: { align: { get: function () { return "left"; } } } }, HTMLElement);
define({ tags: ["template"], ctor: function HTMLTemplateElement(doc, name) { HTMLElement.call(this, doc, name); this.nodeType = 1; }, props: { serialize: { configurable: true, writable: true, value: function (deep) { return "template " + Element.prototype.serialize.call(this, deep); } }, kind: { configurable: true, value: function () { return "template"; } } } }, HTMLElement);
const Slot = define({ tags: ["slot"], ctor: function HTMLSlotElement(doc, name) { HTMLElement.call(this, doc, name); }, props: { childNodes: { configurable: true, get: function () { this._ensureChildNodes(); return this._childNodes.filter(n => n.nodeType === 1); } } } }, HTMLElement);
const Below = define({ superclass: Div, tags: ["below"], ctor: function HTMLBelowElement(doc, name) { Div.call(this, doc, name); }, props: { kind: { configurable: true, value: function () { return "below " + Element.prototype.kind.call(this); } } } });
function create(name) { const impl = impls[name] || HTMLElement; return new impl(null, name); }
function append(parent, kid) {
  kid.parentNode = parent;
  const first = parent._firstChild;
  if (!first) parent._firstChild = kid;
  else { const last = first._previousSibling; last._nextSibling = kid; kid._previousSibling = last; kid._nextSibling = first; first._previousSibling = kid; }
  return kid;
}
function textOf(node, out) { if (node.nodeType === Node.TEXT_NODE) { out.push(node._data); } else { for (let i = 0, n = node.childNodes.length; i < n; i++) textOf(node.childNodes[i], out); } return out; }
function kindsOf(node, kinds) { const k = node.kind(); kinds[k] = (kinds[k] || 0) + 1; for (const kid of node.childNodes) kindsOf(kid, kinds); return kinds; }
function serialized(node) { let text = node.nodeType === 1 ? node.serialize(true) + node.innerHTML + node.depth : "'"; for (let i = 0; i < node.childNodes.length; i++) text += serialized(node.childNodes[i]); return text; }
function sumOf(node, turns) { let sum = 0; for (let t = 0; t < turns; t++) { sum += node.serialize(false).length + node.kind().length + node.innerHTML.length + node.depth + node.childNodes.length; } return sum; }
const names = ["div", "span", "template", "slot", "below", "other"];
function make(depth, at) {
  const top = create(names[(depth + at) % names.length]);
  if (depth === 0) append(top, new Text("t" + at));
  else for (let i = 0; i < 2; i++) { append(top, make(depth - 1, at + i)); if (i) append(top, new Text("x" + at)); }
  return top;
}
const plain = new Element(null, "plain");
append(plain, new Text("of the class"));
const look = label => {
  const trees = [make(3, 0), make(4, 1), plain];
  line(label, trees.map(t => textOf(t, []).join("|")).join(" "));
  line(label, trees.map(t => attempt(() => JSON.stringify(kindsOf(t, {})))).join(" "));
  line(label, trees.map(t => attempt(() => serialized(t).length)).join(" "), attempt(() => serialized(trees[0]).slice(0, 80)));
  line(label, names.concat("plain").map(n => attempt(() => sumOf(n === "plain" ? plain : create(n), 50))).join(" "));
  return trees;
};
const before = look("first");
for (let k = 0; k < 4; k++) look("again" + k);
const old = create("div"), oldSpan = create("span");
append(old, new Text("old"));
// an heir overrides later
Div.prototype.kind = function () { return "late " + this.localName; };
line(old.kind(), before[0].kind(), attempt(() => sumOf(old, 5)));
look("late");
delete Div.prototype.kind;
line(old.kind(), attempt(() => sumOf(old, 5)));
// the class itself changes
const original = Object.getOwnPropertyDescriptors(Element.prototype);
Element.prototype.kind = function () { return "replaced"; };
look("replaced");
Object.defineProperty(Element.prototype, hidden[3], { configurable: true, writable: true, value: function () { return "S"; } });
look("serialize");
Object.defineProperties(Element.prototype, original);
Object.defineProperty(HTMLElement.prototype, hidden[2], { configurable: true, get() { return "defined anew"; } });
look("inner");
delete HTMLElement.prototype.innerHTML;
look("deleted");
line(attempt(() => { old.innerHTML = "set"; return old.localName; }), old.innerHTML);
// one object hides a member
Object.defineProperty(oldSpan, hidden[0], { configurable: true, value: [new Text("own")] });
line(textOf(oldSpan, []).join(), sumOf(oldSpan, 3), textOf(create("span"), []).join());
Object.defineProperty(old, hidden[4], { configurable: true, get() { return 100; } });
line(sumOf(old, 3), sumOf(create("div"), 3));
// heirs get names of the class through Object.assign and a symbol beside them
Object.assign(Div.prototype, { serialize(deep) { return "assigned " + deep; }, [Symbol.toStringTag]: "Div" });
look("assigned");
line(String(create("div")), create("below").serialize(1));
// prototype objects given another prototype
const beside = Object.create(Element.prototype, { kind: { configurable: true, value: function () { return "beside"; } } });
Object.setPrototypeOf(Slot.prototype, beside);
look("beside");
Object.setPrototypeOf(Slot.prototype, HTMLElement.prototype);
Object.setPrototypeOf(old, Text.prototype);
line(attempt(() => old.kind()), attempt(() => old.childNodes.length), attempt(() => sumOf(old, 2)));
Object.setPrototypeOf(old, Div.prototype);
line(attempt(() => old.kind()), attempt(() => old.childNodes.length), attempt(() => sumOf(old, 2)));
Object.defineProperty(ContainerNode.prototype, hidden[0], { configurable: true, get() { this._ensureChildNodes(); return this._childNodes.slice(0, 1); } });
look("fewer");
const trapped = new Proxy(create("div"), { get: (t, k, r) => k === "kind" ? () => "trapped" : Reflect.get(t, k, r) });
line(sumOf(trapped, 3), attempt(() => JSON.stringify(kindsOf(trapped, {}))));
console.log(lines.join("\n"));
