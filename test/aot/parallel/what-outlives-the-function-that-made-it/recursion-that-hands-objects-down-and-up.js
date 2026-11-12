function down(node, depth) { if (!depth) return node; const next = { up: node, depth }; return down(next, depth - 1); }
function count(node) { let n = 0; for (; node; node = node.up) n++; return n; }
function tree(d) { return d ? { l: tree(d - 1), r: tree(d - 1) } : { leaf: true }; }
function leaves(t) { return t.leaf ? 1 : leaves(t.l) + leaves(t.r); }
console.log(count(down(null, 50)), leaves(tree(6)));
