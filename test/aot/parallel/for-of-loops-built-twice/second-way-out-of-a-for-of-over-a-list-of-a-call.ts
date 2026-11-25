// `for (const v of rest) if (test(v)) return true;`: the turns over the short list of a call are written out at the call though the loop has a second way out. Here the list gets out, changes under the loop, or the way out has something to do.
const zero = Number(process.env.NOBODY_SETS_THIS ?? 0);
const show = (name: string, value: unknown) => console.log(name, JSON.stringify(value));
const kept: unknown[] = [];

function some(limit: number, ...values: number[]): boolean { for (const value of values) if (value > limit) return true; return false; }
function firstOver(limit: number, ...values: number[]) { let seen = 0; for (const value of values) { seen++; if (value > limit) return [value, seen]; } return [undefined, seen]; }
function breaks(limit: number, ...values: number[]) { let sum = 0; for (const value of values) { if (value > limit) break; sum += value; } return sum; }
function skips(limit: number, ...values: number[]) { let sum = 0; for (const value of values) { if (value > limit) continue; sum += value; if (sum > 4) return -sum; } return sum; }
function keepsList(limit: number, ...values: number[]) { for (const value of values) if (value > limit) { kept.push(values); return values; } return null; }
function growsList(limit: number, ...values: number[]) { let turns = 0; for (const value of values) { turns++; if (value > limit) return [turns, values.length]; if (values.length < 6) values.push(value + 1); } return [turns, values.length]; }
function shrinksList(...values: number[]) { let turns = 0; for (const value of values) { turns++; if (value === 2) values.length = 2; if (value > 8) return -1; } return turns; }
function withFinally(limit: number, log: string[], ...values: number[]) { try { for (const value of values) { log.push("t" + value); if (value > limit) return "out"; } return "through"; } finally { log.push("finally"); } }
function throwsOut(limit: number, ...values: number[]) { for (const value of values) { if (value > limit) throw new RangeError("over " + value); if (value < 0) return "negative"; } return "through"; }
function holes(limit: number) { let turns = 0; for (const value of [1, , 3] as (number | undefined)[]) { turns++; if (value === undefined) return ["hole", turns]; if (value > limit) return ["over", turns]; } return ["through", turns]; }
function closes(limit: number, log: string[]) {
  const counted = { [Symbol.iterator]() { let n = 0; return { next: () => ({ done: n >= 3, value: n++ }), return: () => { log.push("closed at " + n); return {}; } }; } }; // @ts-expect-error
  for (const value of counted) if (value > limit) return value;
  return -1;
}
function inner(limit: number, ...values: number[]) { let pairs = 0; outer: for (const a of values) { for (const b of values) { if (a + b > limit) continue outer; if (a === b && a > 2) return -pairs; pairs++; } } return pairs; }

for (const k of [0 + zero, 1 + zero, 2 + zero, 9 + zero]) {
  show("some", [some(k, 1, 2, 3), some(k), some(k, k), some(k, k + 1)]);
  show("firstOver", [firstOver(k, 1, 2, 3), firstOver(k, 3, 2, 1), firstOver(k)]);
  show("breaks", [breaks(k, 1, 2, 3), breaks(k, 0, 0, 5, 1)]);
  show("skips", [skips(k, 1, 2, 3), skips(k, 2, 2, 2)]);
  const list = keepsList(k, 1, 2, 3);
  show("keepsList", [list, list === kept[kept.length - 1], kept.length]);
  show("growsList", growsList(k, 0, 1));
  show("shrinksList", shrinksList(1, 2, 3, k));
  const log: string[] = [];
  show("withFinally", [withFinally(k, log, 1, 2, 3), log]);
  let caught = "";
  try { caught = throwsOut(k, 1, 2, -1); } catch (error) { caught = (error as Error).message; }
  show("throwsOut", caught);
  show("holes", holes(k));
  const closed: string[] = [];
  show("closes", [closes(k, closed), closed]);
  show("inner", inner(k, 1, 2, 3));
}
