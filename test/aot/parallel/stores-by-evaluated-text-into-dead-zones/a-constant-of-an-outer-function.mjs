// the text is evaluated one and two functions below the one that declares the constant
function attempt(run) { try { return "answered " + String(run()); } catch (error) { return error.constructor.name; } }
function oneBelow() { function inner() { return attempt(() => eval("late = 2")); } const early = inner(); const late = 1; return early + " | " + inner() + " | " + late; }
function twoBelow() { function middle() { return function inner() { return attempt(() => eval("late = 2")); }; } const early = middle()(); const late = 1; return early + " | " + middle()() + " | " + late; }
function throughTwoTexts() { const early = attempt(() => eval("eval('late = 2')")); const late = 1; return early + " | " + attempt(() => eval("eval('late = 2')")) + " | " + late; }
console.log(oneBelow());
console.log(twoBelow());
console.log(throughTwoTexts());
