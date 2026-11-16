// Constructor functions that a helper makes below a class: the objects that follow the first one have the layout of the class above.
// COUNTER: DynamicSubclassInstances >= 3
"use strict";
const lines = [], line = (...words) => lines.push(words.join(" "));
const Node = (() => {
  function Node() { this.parentNode = null; this._nextSibling = this._previousSibling = this; this._index = undefined; }
  Node.prototype = Object.create(Object.prototype, { isNode: { value: true } });
  return Node;
})();
const Container = (() => {
  function Container() { Node.call(this); this._firstChild = this._childNodes = null; }
  Container.prototype = Object.create(Node.prototype, {
    childNodes: { get: function () { if (!this._childNodes) this._childNodes = []; return this._childNodes; } },
    hasChildNodes: { value: function () { return this._childNodes ? this._childNodes.length > 0 : this._firstChild !== null; } },
  });
  return Container;
})();
const Element = (() => {
  function Element(owner, name) { Container.call(this); this.nodeType = 1; this.owner = owner; this.localName = name; this._attrs = Object.create(null); }
  Element.prototype = Object.create(Container.prototype, { tagName: { get: function () { return this.localName.toUpperCase(); } } });
  return Element;
})();
const impls = Object.create(null);
function define(spec, base) {
  const c = spec.ctor;
  const props = spec.props || {};
  props.constructor = { value: c, writable: true };
  c.prototype = Object.create((spec.superclass || base).prototype, props);
  for (const tag of spec.tags) impls[tag] = c;
  return c;
}
const HTMLElement = define({ superclass: Element, tags: [], ctor: function HTMLElement(owner, name) { Element.call(this, owner, name); } });
define({ tags: ["div"], ctor: function HTMLDivElement(owner, name) { HTMLElement.call(this, owner, name); }, props: { align: { get: function () { return this._attrs.align; } } } }, HTMLElement);
function create(name) { const impl = impls[name] || HTMLElement; return new impl(null, name); }
function row(label, name, count) {
  const made = [];
  for (let i = 0; i < count; i++) made.push(create(name));
  const last = made[count - 1];
  line(label, name, made.length, last.tagName, last.hasChildNodes(), last.childNodes.length, last.hasChildNodes(), Object.keys(last).join(), last instanceof Element, last.isNode);
  for (const e of made) { e.late = e.nodeType; e.nodeType = 2; delete e.owner; }
  line(label, made.map(e => Object.keys(e).length).join(), made.map(e => e.late + e.nodeType).join(), JSON.stringify(Object.keys(made[0])));
  return made;
}
row("first", "div", 6);
row("then", "div", 6);
const p = create("div");
p._attrs.align = "left";
line(p.align, p.localName, p.nodeType, p.constructor === impls.div, Object.getPrototypeOf(p) === impls.div.prototype);
// Objects of chains without any class, made again and again
const mixin = { twice() { return this.n * 2; } };
function Plain(n) { this.n = n; }
Plain.prototype = Object.create(Object.create(mixin));
function Other(n) { this.n = n; this.m = n; }
Other.prototype = Object.create(Object.create(mixin));
const makers = [Plain, Other];
let sum = 0;
for (let i = 0; i < 200; i++) sum += new makers[i & 1](i).twice();
line("sum", sum);
const replaced = impls.div.prototype;
impls.div.prototype = Object.create(Element.prototype, { tagName: { value: "replaced" } });
const after = [create("div"), create("div"), create("div")];
line(after.map(e => e.tagName).join(), after[0] instanceof HTMLElement);
impls.div.prototype = replaced;
line(create("div").tagName, create("div") instanceof HTMLElement);
console.log(lines.join("\n"));
