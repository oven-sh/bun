// the constant belongs to a block, to each turn of a loop, to a switch
function attempt(run) { try { return "answered " + String(run()); } catch (error) { return error.constructor.name; } }
function inBlock() { { const early = attempt(() => eval("late = 2")); const late = 1; return early + " | " + attempt(() => eval("late = 2")) + " | " + late; } }
function inLoop() { const all = []; for (let turn = 0; turn < 3; turn++) { all.push(attempt(() => eval("late = 2"))); const late = turn; all.push(attempt(() => eval("late = 2")), late); } return all.join(" "); }
function inSwitch(which) { switch (which) { case 0: return attempt(() => eval("late = 2")); case 1: const late = 1; return attempt(() => eval("late = 2")) + " | " + late; } }
function inHeadOfLoop() { const all = []; for (const late of [1, 2]) all.push(attempt(() => eval("late = 2")), late); return all.join(" "); }
console.log(inBlock());
console.log(inLoop());
console.log(inSwitch(0));
console.log(inSwitch(1));
console.log(inHeadOfLoop());
