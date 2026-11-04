// console.warn is handed a value of each primitive kind. A toJSON and an inspect function lie on the prototype of each kind: whichever of them the call runs changes a variable and a field.
// Each function reads one of the two, makes the call and reads it again, and does nothing else that could run code.
let calls = 0;
const holder = { calls: 0 }, inspect = Symbol.for("nodejs.util.inspect.custom");
function hook() { calls++; holder.calls++; return "hooked"; }
BigInt.prototype.toJSON = hook; BigInt.prototype[inspect] = hook;
Symbol.prototype.toJSON = hook; Symbol.prototype[inspect] = hook;
String.prototype.toJSON = hook; String.prototype[inspect] = hook;
Number.prototype.toJSON = hook; Number.prototype[inspect] = hook;
Boolean.prototype.toJSON = hook; Boolean.prototype[inspect] = hook;
function variableAroundBigInt(value) { const before = calls; console.warn("%j %o", value, value); return before + " " + calls; }
function fieldAroundBigInt(value) { const before = holder.calls; console.warn("%j %o", value, value); return before + " " + holder.calls; }
function variableAroundSymbol(value) { const before = calls; console.warn("%j %o", value, value); return before + " " + calls; }
function fieldAroundSymbol(value) { const before = holder.calls; console.warn("%j %o", value, value); return before + " " + holder.calls; }
function variableAroundString(value) { const before = calls; console.warn("%j %o", value, value); return before + " " + calls; }
function fieldAroundString(value) { const before = holder.calls; console.warn("%j %o", value, value); return before + " " + holder.calls; }
function variableAroundNumber(value) { const before = calls; console.warn("%j %o", value, value); return before + " " + calls; }
function fieldAroundNumber(value) { const before = holder.calls; console.warn("%j %o", value, value); return before + " " + holder.calls; }
function variableAroundBoolean(value) { const before = calls; console.warn("%j %o", value, value); return before + " " + calls; }
function fieldAroundBoolean(value) { const before = holder.calls; console.warn("%j %o", value, value); return before + " " + holder.calls; }
try { console.log("BigInt", variableAroundBigInt(1n), fieldAroundBigInt(2n)); } catch (error) { console.log("BigInt", error.name); }
try { console.log("Symbol", variableAroundSymbol(Symbol("a")), fieldAroundSymbol(Symbol("b"))); } catch (error) { console.log("Symbol", error.name); }
try { console.log("String", variableAroundString("a"), fieldAroundString("b")); } catch (error) { console.log("String", error.name); }
try { console.log("Number", variableAroundNumber(1.5), fieldAroundNumber(2.5)); } catch (error) { console.log("Number", error.name); }
try { console.log("Boolean", variableAroundBoolean(true), fieldAroundBoolean(false)); } catch (error) { console.log("Boolean", error.name); }
console.log(calls, holder.calls);
