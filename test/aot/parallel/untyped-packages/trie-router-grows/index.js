// a radix of segments, wildcards and parameters, with backtracking
'use strict';
class Node { constructor(part) { this.part = part; this.children = Object.create(null); this.param = null; this.wild = null; this.handlers = null; } }
class Trie {
  constructor(options) { this.root = new Node(''); this.size = 0; this.caseless = !!(options && options.caseless); }
  add(method, pattern, value) {
    let node = this.root, names = [];
    for (const part of pattern.split('/').slice(1)) {
      if (part[0] === ':') { names.push(part.slice(1)); node = node.param || (node.param = new Node(':')); }
      else if (part === '*') { names.push('*'); node = node.wild || (node.wild = new Node('*')); break; }
      else { const key = this.caseless ? part.toLowerCase() : part; node = node.children[key] || (node.children[key] = new Node(key)); }
    }
    (node.handlers || (node.handlers = {}))[method] = { value, names }; this.size++;
    return this;
  }
  find(method, path) {
    const q = path.indexOf('?'); const parts = (q < 0 ? path : path.slice(0, q)).split('/').slice(1);
    const values = []; const hit = this._walk(this.root, parts, 0, values, method);
    if (!hit) return null;
    const params = {}; for (let i = 0; i < hit.names.length; i++) params[hit.names[i]] = values[i];
    return { value: hit.value, params };
  }
  _walk(node, parts, i, values, method) {
    if (i === parts.length) return node.handlers && (node.handlers[method] || node.handlers.ANY) || null;
    const part = parts[i], next = node.children[this.caseless ? part.toLowerCase() : part]; let hit;
    if (next && (hit = this._walk(next, parts, i + 1, values, method))) return hit;
    if (node.param && part !== '') { const mark = values.length; values.push(decodeURIComponent(part)); if ((hit = this._walk(node.param, parts, i + 1, values, method))) return hit; values.length = mark; }
    if (node.wild) { const h = node.wild.handlers && (node.wild.handlers[method] || node.wild.handlers.ANY); if (h) { values.push(parts.slice(i).join('/')); return h; } }
    return null;
  }
}
module.exports = Trie;
