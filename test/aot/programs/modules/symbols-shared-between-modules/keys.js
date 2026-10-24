// The keys of private state, made once here and used by every other module.
export const kHandle = Symbol("handle");
export const kState = Symbol("state");
const kHidden = Symbol("hidden");
export { kHidden as kRenamed };
export let kReplaced = Symbol("replaced, first");
export function replace() { kReplaced = Symbol("replaced, second"); }
export default Symbol("default");
export const table = { kInTable: Symbol("in a table") };
