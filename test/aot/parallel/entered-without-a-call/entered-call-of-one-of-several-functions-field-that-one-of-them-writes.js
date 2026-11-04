// A call finds its callee in a table of functions, one of which writes a field of the object that it is handed, and the caller looks at that field before and behind.
// Under: --aot-testing=CheckProofsAtRunTime: the type of what a call of several functions gives
const visitors = [node => node.pos, node => { node.pos = node.pos + 10; return "moved"; }, node => null];
function make() { return { pos: 1 }; }
function outer(node, kind) { const before = node.pos; const got = visitors[kind](node); const behind = node.pos; return before + ">" + behind + ":" + String(got); }
function looped(node) { let s = ""; for (let i = 0; i < 3; i++) { visitors[i](node); s += node.pos + ","; } return s; }
console.log(outer(make(), 0), outer(make(), 1), outer(make(), 2), looped(make()));
