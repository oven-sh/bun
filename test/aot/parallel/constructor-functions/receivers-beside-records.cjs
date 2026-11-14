// STATISTIC: ReceiversSpeculatedBesideRecords >= 1
// STATISTIC: MethodClassesRejectedForParameters >= 1
// The receiver of a function is the only class that has the names, whatever records pass them along; a parameter is not the
// method's own large class for a few names that a smaller class has too.
globalThis.evaluated = new Function("f", "return f" + (process.argv.length > 100 ? 1 : ""))(exports);
class Context {
  constructor(state, opts) { this.queue = null; this.state = state; this.opts = opts; this.depth = 0; }
  create(node, container, key, listKey) { return globalThis.evaluated.get({ parentPath: this.queue, parent: node, container, key, listKey }); }
}
class Path {
  constructor(parent) {
    this.contexts = []; this.state = null; this.opts = null; this.flags = 0; this.skipKeys = null; this.parentPath = null; this.container = null;
    this.listKey = null; this.key = null; this.node = null; this.parent = parent; this.context = null;
  }
  at(sum) { return sum + this.node.at + this.state; }
}
exports.get = function get({ parentPath, parent, container, key, listKey }) {
  const path = new Path(parent);
  globalThis.evaluated.setup.call(path, parentPath, container, listKey, key);
  return path;
};
function setKey(key) {
  this.key = key;
  this.node = this.container[this.key];
}
function setup(parentPath, container, listKey, key) {
  "use strict";
  this.listKey = listKey;
  this.container = container;
  this.parentPath = parentPath || this.parentPath;
  setKey.call(this, key);
}
function setContext(context) {
  "use strict";
  if (this.skipKeys != null) this.skipKeys = {};
  this.flags = 0;
  if (context) {
    this.context = context;
    this.state = context.state;
    this.opts = context.opts;
  }
  return this;
}
function popAll(queue, context) {
  for (let k = 0; k < queue.length; k++) setContext.call(queue[k], context);
}
exports.popAll = popAll;
exports.setup = setup;
exports.setContext = setContext;
exports.setKey = setKey;

function run(count) {
  const container = [{ at: 1 }, { at: 2 }, { at: 3 }];
  let sum = 0;
  for (let i = 0; i < count; i++) {
    const context = new Context(i & 3, { enter: i });
    for (let k = 0; k < container.length; k++) {
      const path = context.create(null, container, k, "body");
      globalThis.evaluated.setContext.call(path, context);
      sum = path.at(sum) + (path.opts.enter & 1);
      globalThis.evaluated.popAll([path], context);
      if (k === 1) globalThis.evaluated.setContext.call(path, path);
      if (path.context !== (k === 1 ? path : context)) throw new Error("context");
    }
  }
  return sum;
}
console.log(run(2000));
const other = globalThis.evaluated.setContext.call({ opts: 0 }, { state: "s", opts: "o" });
console.log(JSON.stringify(other));
const set = {};
globalThis.evaluated.setup.call(set, null, ["x"], "list", 0);
console.log(JSON.stringify(set), globalThis.evaluated.setContext.call(new Context(1, 2), undefined).flags);
