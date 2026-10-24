// Functions too large to take in answer with a literal whose members come out of loops over a list. A list with a gap sends them down a way on which a member is undefined.
// Their callers read, store, compare, keep and hand on what they get, with whole lists and lists with gaps in turn.
const kept: unknown[] = [];
function bounds(list: number[]) {
  let low = 1000;
  for (let i = 0; i < list.length; i++) if (list[i] < low) low = list[i];
  let high = -1000;
  for (let i = 0; i < list.length; i++) if (list[i] > high) high = list[i];
  let last: number | undefined;
  for (let i = 0; i < list.length; i++) last = list[i];
  return { low, high, last };
}
function firstAndLast(list: number[]) {
  let first = list[0], last = list[0], n = 0;
  for (let i = 0; i < list.length; i++) { last = list[i]; n++; }
  for (let i = list.length - 1; i >= 0; i--) first = list[i];
  return { first, last, n };
}
const callers: Record<string, (list: number[], key: string) => unknown> = {
  reads(list: number[]) { const b = bounds(list); return b.high - b.low; },
  readsAll(list: number[]) { const b = bounds(list); return b.high + "/" + b.low + "/" + b.last; },
  stores(list: number[]) { const b = bounds(list); b.low = b.high; b.high += 1; return b.low + b.high; },
  storesOtherKind(list: number[]) { const b = bounds(list); (b as any).low = "text"; return b.low + b.high; },
  adds(list: number[]) { const b = bounds(list); (b as any).extra = 5; return (b as any).extra + b.high; },
  deletes(list: number[]) { const b = bounds(list); delete (b as any).low; return String(b.low) + Object.keys(b); },
  keepsSometimes(list: number[]) { const b = bounds(list); if (b.last === undefined) kept.push(b); return b.high; },
  keepsOften(list: number[]) { const b = bounds(list); if (b.high > 5) kept.push(b); return b.low; },
  compares(list: number[]) { const b = bounds(list), c = bounds(list); return (b === c) + "" + (b === b) + (b.low === c.low); },
  inLoop(list: number[]) { let s = 0; for (let k = 0; k < 3; k++) { const b = bounds(list); s += b.high - b.low + k; } return s; },
  carried(list: number[]) { let b = bounds(list); for (let k = 0; k < 3; k++) { const c = bounds(list); if (c.high >= b.high) b = c; } return b.high + "" + b.last; },
  captured(list: number[]) { const b = bounds(list); const f = () => b.high; return f() + b.low; },
  destructured(list: number[]) { const { low, high, last = "none" } = bounds(list); return low + "," + high + "," + last; },
  spreads(list: number[]) { const c = { ...bounds(list), more: 1 }; return JSON.stringify(c); },
  text(list: number[]) { return JSON.stringify(bounds(list)); },
  keys(list: number[]) { let s = ""; const b = bounds(list); for (const k in b) s += k + (b as any)[k]; return s; },
  byKey(list: number[], key: string) { const b = bounds(list); return (b as any)[key]; },
  caught(list: number[]) { try { const b = bounds(list); if (b.last === undefined) throw b; return b.high; } catch (e) { return "caught " + (e as any).low; } },
  oneOfTwo(list: number[], key: string) { const b = key === "low" ? bounds(list) : firstAndLast(list); return b.last; },
  nested(list: number[]) { const b = bounds(list), f = firstAndLast(list); return { b, f }.b.high + f.n; },
  returned(list: number[]) { return bounds(list); },
  typeOf(list: number[]) { const b = bounds(list); return typeof b + typeof b.last; },
  has(list: number[]) { const b = bounds(list); return ("low" in b) + "" + b.hasOwnProperty("last"); },
};
function gap(): number[] { const a: number[] = [1]; a[2] = 3; return a; }
function empty(): number[] { const a: number[] = []; a.length = 2; return a; }
const lists: number[][] = [[3, 1, 2], [7, 8, 9, 6], gap(), empty(), [], [5], [2.5, 1], JSON.parse("[4,null]"), JSON.parse('["a","b"]'), gap()];
const lines = [];
for (const name in callers) {
  const f = callers[name];
  let s = "";
  for (let round = 0; round < 400; round++) {
    const list = round % 50 === 49 ? lists[2 + ((round / 50) | 0) % (lists.length - 2)] : lists[round & 1];
    let r = f(list, round & 2 ? "low" : "high");
    if (typeof r === "object") r = JSON.stringify(r);
    if (round % 50 >= 48) s += r + ";";
  }
  lines.push(name + " " + s);
}
lines.push("kept " + kept.length + " " + JSON.stringify(kept.slice(0, 3)) + JSON.stringify(kept.slice(-3)) + new Set(kept).size);
console.log(lines.join("\n"));
