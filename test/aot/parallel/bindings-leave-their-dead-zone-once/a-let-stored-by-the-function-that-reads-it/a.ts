await null;
const unseen = (0, eval)("(x) => x");
export let held = process.argv.length > 100 ? 5 : 1;
export function write(value: number) { held = value; unseen(value); return held + ":" + held; }
export function read() { const first = held; unseen(first); return first + held; }
