var __commonJS = (cb, mod) => () => (mod || cb((mod = { exports: {} }).exports, mod), mod.exports);
var require_tree = __commonJS(function (exports, module) {
  module.exports = function (host) {
    function Node(tag) {
      this.tag = tag;
      this.parent = null;
      this.lanes = 0;
    }
    function mark(node, lane) {
      for (node.lanes |= lane; node.parent !== null; ) (node = node.parent), (node.lanes |= lane);
      return node;
    }
    return {
      make(tag, parent) {
        var node = new Node(tag);
        node.parent = parent;
        host.see(node);
        return node;
      },
      mark,
    };
  };
});
export const tree = require_tree()({
  see(node) {
    globalThis.lastSeen = node;
  },
});
