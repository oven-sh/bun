// evaluated text stores into bindings at the top of a module that are not yet initialized
function attempt(run) { try { return "answered " + String(run()); } catch (error) { return error.constructor.name; } }
console.log("in the dead zone: " + attempt(() => eval("lateConstant = 2")) + " | " + attempt(() => eval("[lateConstant] = [2]")) + " | " + attempt(() => eval("lateVariable = 2")));
const lateConstant = 1;
let lateVariable = 1;
console.log("behind it: " + attempt(() => eval("lateConstant = 2")) + " | " + lateConstant + " | " + attempt(() => eval("lateVariable = 2")) + " | " + lateVariable);
