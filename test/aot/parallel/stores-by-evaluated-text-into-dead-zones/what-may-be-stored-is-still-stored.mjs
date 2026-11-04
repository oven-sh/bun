// a variable, a class, a parameter and what a catch clause binds take the store of evaluated text, and compiled code reads the new value
function attempt(run) { try { return "answered " + String(run()); } catch (error) { return error.constructor.name; } }
function variable() { let late = 1; const seen = attempt(() => eval("late = 2")); return seen + " | " + late; }
function declaredClass() { class Late {} const seen = attempt(() => eval("Late = 2")); return seen + " | " + Late; }
function parameter(given) { const seen = attempt(() => eval("given = 2")); return seen + " | " + given; }
function parameterAhead(first = attempt(() => eval("second = 2")), second = 1) { return first + " | " + second; }
function caught() { try { throw 1; } catch (problem) { const seen = attempt(() => eval("problem = 2")); return seen + " | " + problem; } }
function caughtInParts() { try { throw { part: 1 }; } catch ({ part }) { const seen = attempt(() => eval("part = 2")); return seen + " | " + part; } }
function declaredFunction() { function late() {} const seen = attempt(() => eval("late = 2")); return seen + " | " + late; }
for (const probe of [variable, declaredClass, () => parameter(1), parameterAhead, caught, caughtInParts, declaredFunction]) console.log((probe.name || "parameter") + ": " + probe());
