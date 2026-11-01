// Alone: whether the call is bound to the built-in is a fact about the whole program.
// A member of a native module's object is changed, then used for the first time.
import types from "node:util/types";
const tell = act => { try { return String(act()); } catch (error) { return error.constructor.name; } };
const hiddenText = text => new Function(JSON.parse(JSON.stringify(text)))();
Object.defineProperty(types, "isDate", { get() { return () => "mine"; }, configurable: true });
console.log(tell(() => types.isDate(1)));
