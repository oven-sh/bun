// the text makes a function that stores: called in the dead zone it gets one error, called behind the declaration the other
function attempt(run) { try { return "answered " + String(run()); } catch (error) { return error.constructor.name; } }
function arrow() { const store = eval("() => { late = 2; }"); const early = attempt(store); const late = 1; return early + " | " + attempt(store) + " | " + late; }
function ordinary() { const store = eval("(function () { late = 2; })"); const early = attempt(store); const late = 1; return early + " | " + attempt(store) + " | " + late; }
function byParts() { const store = eval("() => { [late] = [2]; }"); const early = attempt(store); const late = 1; return early + " | " + attempt(store) + " | " + late; }
function overVariable() { const store = eval("() => { late = 2; }"); const early = attempt(store); let late = 1; return early + " | " + attempt(store) + " | " + late; }
console.log(arrow());
console.log(ordinary());
console.log(byParts());
console.log(overVariable());
