type More = { request: number; user: string };
function die(): never { throw new Error("no"); }
function born(n: number): More { return { request: n, user: die() }; }
const sources: More[] = []; try { sources.push(born(1)); } catch { sources.length = 0; }
let said = ""; for (let i = 0; i < 2; i++) { const first: any = { z: i }; const made: any = { ...first, ...sources[i] }; said += Object.keys(made).join() + ";"; }
console.log("SAID " + said);
export {};
