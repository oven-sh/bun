// a list changed by splices in loops: moves, replaces, windows, undo; lists of lists flattened; array-likes and sparse lists
'use strict';
function Editor(items) { this.items = items || []; this.undo = []; this.removed = 0; }
Editor.prototype.insert = function (at) { var add = Array.prototype.slice.call(arguments, 1); this.items.splice.apply(this.items, [at, 0].concat(add)); this.undo.push({ at: at < 0 ? Math.max(0, this.items.length - add.length + at) : Math.min(at, this.items.length - add.length), take: add.length, put: [] }); return this.items.length; };
Editor.prototype.remove = function (at, n) { var gone = n === undefined ? this.items.splice(at) : this.items.splice(at, n); this.removed += gone.length; this.undo.push({ at: at < 0 ? this.items.length : at, take: 0, put: gone }); return gone; };
Editor.prototype.replace = function (test, fn) { var hits = 0; for (var i = 0; i < this.items.length; i++) { if (!test(this.items[i], i)) continue; var r = fn(this.items[i]); hits++; if (Array.isArray(r)) { this.items.splice.apply(this.items, [i, 1].concat(r)); i += r.length - 1; } else if (r === undefined) { this.items.splice(i--, 1); } else this.items.splice(i, 1, r); } this.undo.length = 0; return hits; };
Editor.prototype.move = function (from, to) { var x = this.items.splice(from, 1); this.items.splice(to, 0, x[0]); return x.length; };
Editor.prototype.back = function () { var u = this.undo.pop(); if (!u) return false; this.items.splice.apply(this.items, [u.at, u.take].concat(u.put)); return true; };
Editor.prototype.windows = function (size, step) { var out = []; for (var i = 0; i + size <= this.items.length; i += step) out.push(this.items.slice(i, i + size)); return out; };
function unique(list) { for (var i = 0; i < list.length; i++) for (var k = i + 1; k < list.length;) if (list[k] === list[i]) list.splice(k, 1); else k++; return list; }
function drop(list, x) { var i; while ((i = list.indexOf(x)) !== -1) list.splice(i, 1); return list; }
function flatten(list, depth) { var out = []; for (var i = 0; i < list.length; i++) { if (!(i in list)) continue; if (Array.isArray(list[i]) && depth !== 0) out.push.apply(out, flatten(list[i], depth - 1)); else out.push(list[i]); } return out; }
function chunk(list, n) { var copy = list.slice(), out = []; while (copy.length) out.push(copy.splice(0, n)); return out; }
function merge(a, b) { var out = [], i = 0, k = 0; while (i < a.length || k < b.length) out.push(k >= b.length || i < a.length && a[i] <= b[k] ? a[i++] : b[k++]); return out; }
module.exports = { Editor: Editor, unique: unique, drop: drop, flatten: flatten, chunk: chunk, merge: merge };
