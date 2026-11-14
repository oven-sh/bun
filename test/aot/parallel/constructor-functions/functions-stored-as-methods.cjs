// STATISTIC: StraightSiteCachedReads <= 8
// Functions that store into `this` and are only stored under names of methods run on the objects that they are laid on.
class Path {
  constructor(hub, parent) {
    this.contexts = []; this.state = null; this.opts = null; this.flags = 0; this.parentPath = null; this.container = null;
    this.listKey = null; this.key = null; this.node = null; this.type = null; this.parent = parent; this.hub = hub; this.scope = null;
  }
  getScope(scope) { return this.type === "Scope" ? { of: this.node } : scope; }
}
function setScope() {
  if (this.opts != null && this.opts.noScope) return;
  let path = this.parentPath;
  if (this.key === "key" || this.listKey === "decorators") path = path.parentPath;
  let target = null;
  while (path && !target) { target = path.scope; path = path.parentPath; }
  this.scope = this.getScope(target);
}
function setKey(key) {
  this.key = key;
  this.node = this.container[this.key];
  this.type = this.node == null ? undefined : this.node.type;
}
function setup(parentPath, container, listKey, key) {
  this.listKey = listKey;
  this.container = container;
  this.parentPath = parentPath || this.parentPath;
  setKey.call(this, key);
}
function visit(opts) {
  this.opts = opts;
  if (!this.node) return false;
  setScope.call(this);
  this.flags |= this.scope ? 1 : 2;
  return this.flags === 1;
}
const methods = { setScope: setScope, setKey: setKey, setup: setup, visit: visit };
Object.assign(Path.prototype, methods);
const namespace = { get setScope() { return setScope; }, visit: () => visit };
exports.setKey = setKey;

function run(count) {
  const top = { type: "Scope", body: [] };
  for (let i = 0; i < 8; i++) top.body.push({ type: i & 1 ? "Call" : "Name", at: i });
  const root = new Path("hub", null);
  root.setup(null, { program: top }, null, "program");
  let seen = 0;
  for (let i = 0; i < count; i++) {
    root.visit(i & 1 ? null : { noScope: false });
    for (let k = 0; k < top.body.length; k++) {
      const path = new Path("hub", top);
      setup.call(path, root, top.body, "body", k);
      if (path.visit(null)) seen += path.node.at;
      if (path.scope.of !== top) throw new Error("scope");
    }
  }
  return seen;
}
console.log(run(1000), namespace.setScope === setScope, namespace.visit() === visit);
const box = { container: { b: { type: "B" } } };
setKey.call(box, "b");
console.log(JSON.stringify(box), Object.keys(new setup(null, { x: { type: "X" } }, null, "x")).join());
try { setKey("x"); } catch (error) { console.log(error.name); }
