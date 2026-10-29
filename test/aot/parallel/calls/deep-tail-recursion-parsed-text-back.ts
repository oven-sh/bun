// Two functions call each other in tail position three million deep. One answers `any`, the other declares `number`, and what comes back in the end is parsed out of a text that is made at run time: the stack stays level, as it does with the types erased.
const hops = 3_000_000;
const text = String(Date.now()).slice(99) + "7";
function anyNumber(n: number): any { return n === 0 ? JSON.parse(text) : toNumber(n - 1); }
function toNumber(n: number): number { return anyNumber(n); }
try { console.log(toNumber(hops)); } catch (error) { console.log((error as Error).constructor.name); }
export {};
