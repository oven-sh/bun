// the name that a function expression has inside itself is never in a dead zone: strict text gets a TypeError
function attempt(run) { try { return "answered " + String(run()); } catch (error) { return error.constructor.name; } }
function straight() { return (function named() { const seen = attempt(() => eval("named = 2")); return seen + " | " + typeof named; })(); }
function byArrow() { return (function named() { const seen = attempt(eval("() => { named = 2; }")); return seen + " | " + typeof named; })(); }
console.log(straight());
console.log(byArrow());
