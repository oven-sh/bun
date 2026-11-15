// the text, and the function that asks for it, come through code that the build has not seen
const hidden = (0, eval)("(x) => x");
function attempt(run) { try { return "answered " + String(hidden(run)()); } catch (error) { return error.constructor.name; } }
function probe() { const early = attempt(() => eval(hidden("late = 2"))); const late = 1; return early + " | " + attempt(() => eval(hidden("late = 2"))) + " | " + late; }
console.log(probe());
