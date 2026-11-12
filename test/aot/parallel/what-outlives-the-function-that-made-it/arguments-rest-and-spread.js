let kept;
function rest(...all) { kept = all; return all.length; }
function args() { return arguments; }
function pass(i) { const list = [{ v: i }, { v: i + 1 }]; return rest(...list) + args(list, { v: 9 })[1].v; }
console.log(pass(1), kept[1].v);
