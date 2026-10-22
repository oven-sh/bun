// Untyped JavaScript, strict. Nothing declares the late properties: the compiler finds them in the stores.
// After 3000 rounds the prototypes of a class, of its base and of a constructor function gain accessors, values and read-only members of those names.
const log = [];
class Base {
  constructor(id) {
    this.id = id;
  }
}
class Node extends Base {
  constructor(id) {
    super(id);
    this.kind = id & 3;
  }
  get twice() {
    return this.id * 2;
  }
}
function Token(id) {
  this.id = id;
}
function parentOf(node) {
  return node.parent;
}
function attach(node, parent) {
  node.parent = parent;
}
function typeOf(node) {
  return node.type || (node.type = "type " + node.id);
}
function state(node) {
  const parent = parentOf(node);
  return `${parent && parent.id} ${node.type} [${Object.keys(node)}]`;
}
function attempt(run) {
  try {
    return String(run());
  } catch (error) {
    return error.constructor.name;
  }
}
const makers = [id => new Node(id), id => new Token(id), id => new Base(id)];

let length = 0;
const root = new Node(0);
for (let i = 0; i < 3000; i++) {
  const node = makers[i % 3](i);
  length += state(node).length;
  if (i & 1) attach(node, root);
  if (i & 2) typeOf(node);
  length += state(node).length;
}
console.log("warm", length);

const old = makers.map((make, index) => make(index + 1));
const oldFilled = makers.map((make, index) => make(index + 4));
for (const node of oldFilled) {
  attach(node, root);
  typeOf(node);
}
const line = () => [...old, ...oldFilled, ...makers.map((make, index) => make(index + 7))].map(state).join(" | ");
console.log("before:", line());
Object.defineProperty(Base.prototype, "parent", {
  get() {
    return { id: "parent from the base of " + this.id };
  },
  set(value) {
    log.push(`parent = ${value.id} on ${this.id}`);
  },
  configurable: true,
});
Token.prototype["ty" + "pe"] = "type of every token";
Object.defineProperty(Node.prototype, "type", { value: "fixed type", writable: false, configurable: true });
console.log("changed:", line());
console.log("stores:", old.map(node => attempt(() => attach(node, root)) + " " + attempt(() => typeOf(node)) + " " + attempt(() => (node.type = "stored"))).join(" | "));
console.log("after:", line());
console.log(log.join(", "));
delete Base.prototype.parent;
delete Token.prototype.type;
delete Node.prototype.type;
console.log("gone again:", line());
