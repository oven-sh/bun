"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
function _export(target, all) {
    for(var name in all)Object.defineProperty(target, name, {
        enumerable: true,
        get: all[name]
    });
}
_export(exports, {
    Node4: function() {
        return Node4;
    },
    create: function() {
        return create;
    },
    run: function() {
        return run;
    }
});
class Node4 { constructor(kind, pos) { this.pos = pos; this.kind = kind; this.flags = 0; this.parent = undefined; } getStart() { return this.pos; } }
function create(kind, parent) { const n = new Node4(kind, 1); n.parent = parent; return n; }
function depth(n) { let d = 0; while (n) { if (n.kind === 3) d++; d += n.flags + n.getStart(); n = n.parent; } return d; }
function run(m) { let s = 0; for (let i = 0; i < m; i++) { let p; for (let k = 0; k < 8; k++) p = create(k & 3, p); s += depth(p); } return s; }
