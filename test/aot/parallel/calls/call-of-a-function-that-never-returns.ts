// Behind a call of a function that always throws, nothing runs, but a handler in the caller does, and a function that only seems to throw goes on.
const seen: unknown[] = [];
const say = (name: string, run: () => unknown) => {
  try { seen.push(name + " " + String(run())); } catch (error) { seen.push(name + " threw " + String((error as Error).message ?? error)); }
};
function refuse(value: number): never { throw new RangeError("negative " + value); }
function viaAnother(value: number): never { refuse(value + 1); }
function mutualA(n: number): never { if (n > 2) throw new Error("deep " + n); mutualB(n + 1); }
function mutualB(n: number): never { mutualA(n + 1); }
function returnsFromFinally(): number { try { throw new Error("gone"); } finally { return 2; } }
function catchesItself(): number { try { refuse(1); } catch { return 3; } }
function throwsInCatch(): never { try { refuse(1); } catch (error) { throw new Error("again " + (error as Error).message); } }
function lied(): never { return 5 as never; }
function bySomeBranch(flag: boolean): never { if (flag) throw new Error("branch"); return 6 as never; }
async function asyncFails(): Promise<never> { throw new Error("async"); }
function* generatorFails(): Generator<number, never> { yield 1; throw new Error("generator"); }

function twiceOf(value: number): number { if (value < 0) refuse(value); return value * 2; }
function afterTheCall(value: number): string { let step = "before"; try { refuse(value); step = "behind"; } catch { step += " caught"; } finally { step += " finally"; } return step; }
function loop(list: number[]): number { let total = 0; for (const value of list) { if (value < 0) { try { viaAnother(value); } catch { continue; } } total += value; } return total; }
function usedResult(value: number): number { const never = value > 0 ? refuse(value) : 7; return never + 1; }
function asArgument(value: number): number[] { return [value, value < 0 ? refuse(value) : 1]; }
function inCondition(value: number): string { if (value > 0 && refuse(value)) return "yes"; return "no"; }
function goesOn(): string { const a = lied() as unknown; const b = bySomeBranch(false) as unknown; return String(a) + String(b); }

say("twice", () => twiceOf(2));
say("twice", () => twiceOf(-2));
say("handler", () => afterTheCall(1));
say("loop", () => loop([1, -1, 2, -2, 3]));
say("result", () => usedResult(0));
say("result", () => usedResult(1));
say("argument", () => asArgument(1).join());
say("argument", () => asArgument(-1).join());
say("condition", () => inCondition(0));
say("condition", () => inCondition(1));
say("mutual", () => mutualA(0));
say("finally", () => returnsFromFinally());
say("catches", () => catchesItself());
say("in catch", () => throwsInCatch());
say("goes on", () => goesOn());
say("branch", () => bySomeBranch(true));
say("async", () => { asyncFails().catch(error => seen.push("rejected " + error.message)); return "goes on"; });
say("generator", () => { const g = generatorFails(); return g.next().value; });
for (let i = 0; i < 2000; i++) { twiceOf(i); try { twiceOf(-i - 1); } catch {} afterTheCall(i); }
await null;
console.log(seen.join("\n"));
