(globalThis.runs ??= []).push("lib");
export function f() {}
export let a = 1;
if (a) throw new RangeError("made up");
export default 3;
