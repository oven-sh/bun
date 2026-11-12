"use strict";
// Non-extensible and sealed objects take stores into the properties they have and reject new ones. Frozen objects reject both.
class Fiber {
  constructor(tag) {
    this.tag = tag;
    this.lanes = 0;
    this.child = null;
    this.duration = -0;
    Object.preventExtensions(this);
  }
}
function Node(tag) {
  this.tag = tag;
  this.lanes = 0;
  this.child = null;
  this.duration = -0;
  Object.preventExtensions(this);
}
class Open {
  constructor(tag) {
    this.tag = tag;
    this.lanes = 0;
    this.child = null;
    this.duration = -0;
  }
}
function literal(tag) {
  return { tag, lanes: 0, child: null, duration: -0 };
}
const said = [];
function attempt(name, f) {
  try {
    const answer = f();
    said.push(name + " " + String(answer));
  } catch (error) {
    said.push(name + " " + error.constructor.name);
  }
}
function overwrite(o, lanes, child) {
  o.lanes = lanes;
  o.child = child;
  o.duration = lanes + 0.5;
  o.lanes |= 1;
  return o.lanes + o.duration;
}
function create(o, value) {
  o.sibling = value;
  return o.sibling;
}
function both(o, value) {
  o.lanes = value;
  o.sibling = value;
  o.child = value;
  return o.lanes;
}
function loop(o, count) {
  for (let i = 0; i < count; i++) {
    o.lanes += i;
    o.duration = i;
  }
  return o.lanes + ":" + o.duration;
}
function change(o, level) {
  o.lanes = 1;
  level(o);
  o.lanes = 2;
  return o.lanes;
}
class Fields extends (function (o) { return o; }) {
  lanes = 9;
}
class NewField extends (function (o) { return o; }) {
  sibling = 9;
}
const levels = { none: o => o, prevent: Object.preventExtensions, seal: Object.seal, freeze: Object.freeze };
const makers = { Fiber: t => new Fiber(t), Node: t => new Node(t), Open: t => new Open(t), literal };
for (const [m, make] of Object.entries(makers)) {
  for (const [l, level] of Object.entries(levels)) {
    const fresh = () => level(make(3));
    const name = m + " " + l + " ";
    attempt(name + "overwrite", () => overwrite(fresh(), 4, fresh()));
    attempt(name + "create", () => create(fresh(), 4));
    attempt(name + "both", () => both(fresh(), 4));
    attempt(name + "loop", () => loop(fresh(), 5));
    attempt(name + "change", () => change(make(1), level));
    attempt(name + "field", () => new Fields(fresh()).lanes);
    attempt(name + "new field", () => new NewField(fresh()).sibling);
    attempt(name + "descriptor", () => JSON.stringify(Object.getOwnPropertyDescriptor(new Fields(fresh()), "lanes")));
    attempt(name + "define", () => Object.defineProperty(fresh(), "lanes", { value: 8 }).lanes);
    attempt(name + "assign", () => Object.assign(fresh(), { lanes: 6, child: 7 }).lanes);
    attempt(name + "assign new", () => Object.assign(fresh(), { lanes: 6, other: 7 }).other);
    attempt(name + "delete", () => delete fresh().lanes);
    attempt(name + "again", () => {
      const o = make(2);
      delete o.child;
      level(o);
      o.lanes = 5;
      o.child = 1;
      return o.child;
    });
    attempt(name + "levels", () => [Object.isExtensible(fresh()), Object.isSealed(fresh()), Object.isFrozen(fresh())]);
  }
}
for (let i = 0; i < said.length; i += 4) console.log(said.slice(i, i + 4).join(" . "));
