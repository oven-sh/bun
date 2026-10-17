// Functions that read one and the same `let` or `const` of their module more than once, called before the declaration has run and after: every read of a variable that is
// not yet initialized throws a ReferenceError, also the second one, also one in a handler that has just caught the first, also one on a road that the first read is not on.
const lines: string[] = [];
function attempt(what: string, act: () => unknown): void { try { lines.push(what + ": " + String(act())); } catch (error) { lines.push(what + ": " + (error instanceof ReferenceError ? "ReferenceError" : "another error: " + error)); } }
function twice(): number { return counter + counter; }
function thrice(n: number): number { let total = counter; for (let i = 0; i < n; i++) total += counter; return total + counter; }
function caughtThenAgain(): string { let first = "none"; try { first = "read " + counter; } catch { first = "caught"; } return first + ", then " + counter; }
function caughtTwice(): string { let out = ""; try { out += counter; } catch { out += "c1 "; try { out += counter; } catch { out += "c2"; } } return out; }
function oneRoadOrTheOther(flag: boolean): number { if (flag) return counter + 1; return limit + counter; }
function afterABranch(flag: boolean): number { let seen = 0; if (flag) seen = counter; return seen + counter; }
function storesThenReads(v: number): number { counter = v; return counter + counter; }
function readsBoth(): string { return label + counter + label + limit; }
function inAClosure(): number { const read = () => counter + counter; return read() + counter; }
function finallyReads(): string { let out = "start"; try { out += counter; } finally { lines.push("finally ran"); } return out + counter; }
const all: [string, () => unknown][] = [["twice", twice], ["thrice", () => thrice(3)], ["caughtThenAgain", caughtThenAgain], ["caughtTwice", caughtTwice], ["one road", () => oneRoadOrTheOther(true)], ["the other", () => oneRoadOrTheOther(false)],
  ["after a branch taken", () => afterABranch(true)], ["after a branch not taken", () => afterABranch(false)], ["readsBoth", readsBoth], ["inAClosure", inAClosure], ["finallyReads", finallyReads]];
for (const [what, act] of all) attempt("early " + what, act);
attempt("early store", () => storesThenReads(5));
let counter = 10;
for (const [what, act] of all) attempt("counter is there, " + what, act);
const limit = 100;
const label = "L";
for (const [what, act] of all) attempt("late " + what, act);
attempt("late store", () => storesThenReads(7)); attempt("late twice", twice);
console.log(lines.join("\n"));
