// `new` of a constructor that comes out of an allocator object whose members are replaced later, as TypeScript's objectAllocator is.
// Every constructor that reaches the `new` must give the object of its own class, and a value that is not a constructor must throw.
// Env of the executable: BUN_JSC_validateAOTRuntime=1
function PlainNode(kind) { this.kind = kind; this.flags = 0; this.parent = undefined; }
PlainNode.prototype.describe = function () { return "plain " + this.kind; };
function ServiceNode(kind) { this.kind = kind; this.flags = 1; this.parent = undefined; this.cache = undefined; }
ServiceNode.prototype.describe = function () { return "service " + this.kind; };
class ClassNode { constructor(kind) { this.kind = kind; this.flags = 2; } describe() { return "class " + this.kind; } }
class DerivedNode extends ClassNode { constructor(kind) { super(kind); this.extra = kind * 2; } }
function ReturnsOther(kind) { this.kind = kind; return { kind: -kind, flags: 9, describe() { return "other " + this.kind; } }; }

const allocator = { getNodeConstructor: () => PlainNode };
// The compiler sees PlainNode and ServiceNode reach the `new`. Code that it does not see installs the others.
const install = new Function("allocator", "value", "allocator.getNodeConstructor = () => value");
let count = 0;
function createNode(kind) {
  const Node = allocator.getNodeConstructor();
  const node = new Node(kind);
  count++;
  node.id = count;
  return node;
}
function createNamed(kind, name) {
  const node = createNode(kind);
  node.name = name;
  if (kind & 1) node.odd = true;
  return node;
}
function show(node) {
  console.log(node.describe(), node.flags, node.id, node.name, node.odd, Object.keys(node).join(), node.constructor.name);
}
for (let i = 0; i < 3; i++) show(createNamed(i, "a" + i));
Object.assign(allocator, { getNodeConstructor: () => ServiceNode });
for (let i = 0; i < 3; i++) show(createNamed(i, "b" + i));
install(allocator, ClassNode);
for (let i = 0; i < 3; i++) show(createNamed(i, "c" + i));
install(allocator, DerivedNode);
for (let i = 0; i < 3; i++) show(createNamed(i, "d" + i));
install(allocator, ReturnsOther);
for (let i = 0; i < 3; i++) show(createNamed(i, "e" + i));
install(allocator, ServiceNode.bind(null));
show(createNamed(4, "bound"));
install(allocator, new Proxy(PlainNode, { construct(target, args) { return new target(args[0] + 100); } }));
show(createNamed(5, "proxy"));
for (const notConstructor of [() => 1, undefined, null, 7, {}, Math.max]) {
  install(allocator, notConstructor);
  try { createNamed(6, "never"); console.log("no error"); } catch (error) { console.log(error instanceof TypeError, count); }
}

// The prototype of one of the constructors changes between two constructions.
allocator.getNodeConstructor = () => ServiceNode;
ServiceNode.prototype = { describe() { return "replaced " + this.kind; } };
show(createNamed(7, "late"));
Object.defineProperty(ServiceNode.prototype, "flags", { set(value) { console.log("setter", value); }, get() { return "got"; }, configurable: true });
show(createNamed(8, "setter"));

// Many objects of both classes in turn, with a collection in between.
delete ServiceNode.prototype.flags;
let sum = 0;
for (let i = 0; i < 20000; i++) {
  allocator.getNodeConstructor = i & 1 ? () => PlainNode : () => ServiceNode;
  const node = createNamed(i, "n");
  sum += node.flags + node.id + (node.odd ? 1 : 0);
  if (i === 10000) Bun.gc(true);
}
console.log(sum);
