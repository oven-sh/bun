// A closure over a counter is handed to a function that calls itself and only calls what it is handed, or on one node keeps it. What was kept still counts behind the return of its maker.
// Under: --aot-testing=WritesBodiesStraight: the closed ways give the same answers
globalThis.report = value => { console.log(typeof value === "string" ? JSON.stringify(value) : Object.is(value, -0) ? "-0" : String(value)); };
const kept = [];
function walk(node, visit) { if (!node) return 0; return visit(node.value) + walk(node.left, visit) + walk(node.right, visit); }
function keepsOne(node, visit) { if (!node) return 0; if (node.value === 3) kept.push(visit); return visit(node.value) + keepsOne(node.left, visit) + keepsOne(node.right, visit); }
function tree(depth, from) { return depth ? { value: from, left: tree(depth - 1, from * 2), right: tree(depth - 1, from * 2 + 1) } : null; }
function lent(depth) { let seen = 0; const sum = walk(tree(depth, 1), value => { seen++; return value; }); return sum + ":" + seen; }
function lentInAField(depth) { let seen = 0; const tools = { visit: value => { seen += value; return 1; }, depth }; return walk(tree(tools.depth, 1), tools.visit) + ":" + seen; }
function leaves(depth) { let seen = 0; const sum = keepsOne(tree(depth, 1), value => { seen++; return value + seen; }); return sum + ":" + seen; }
function twoShareOne(depth) { let seen = 0; const up = value => { seen += value; return seen; }; const down = value => { seen -= 1; return seen; }; return walk(tree(depth, 1), up) + ":" + walk(tree(depth, 1), down) + ":" + seen; }
function madeInALoop(turns) { let said = ""; for (let turn = 0; turn < turns; turn++) { const holder = { by: turn, visit: value => value * holder.by }; said += walk(tree(2, 1), holder.visit) + ","; if (turn === 1) kept.push(holder.visit); } return said; }
report(lent(3));
report(lentInAField(3));
report(leaves(3));
report(twoShareOne(2));
report(madeInALoop(3));
report(kept.length);
report(kept[0](10));
report(kept[0](10));
report(kept[1](10));
report("end");
