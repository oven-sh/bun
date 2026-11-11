// Loops whose counter starts at a parameter: below zero, past int32, past 2^53, fractions, -0, NaN, up and down, as a key of every kind of list.
let log = "";
function show(...values: any[]): void { for (const v of values) log += (Object.is(v, -0) ? "-0" : typeof v === "object" && v ? JSON.stringify(v) : String(v)) + ","; log += ";"; }
const parse = (text: string): any => JSON.parse(text);
const int32s = (): number[] => parse("[5,17,-3,0,7,19,23,100000,3,4]");
const doubles = (): number[] => parse("[5.5,17,-0.0,0,1e300,7,-2.25]");
const holes = (): number[] => { const a = int32s(); delete a[3]; return a; };
const named = (): number[] => { const a: any = int32s(); a[-1] = 99; a["-2"] = 98.5; a[4294967295] = 97; return a; };
const mixed = (): any[] => [1, "two", 3.5, null, undefined, 4];
function sum(values: number[], from: number): number { let total = 0; for (let i = from; i < from + 4 && i < values.length; i++) total += values[i]; return total; }
function bounds(values: number[], from: number): { low: number; high: number } {
  let low = values[from];
  let high = values[from];
  for (let i = from + 1; i < from + 4 && i < values.length; i++) {
    if (values[i] < low) low = values[i];
    if (values[i] > high) high = values[i];
  }
  return { low, high };
}
function down(values: number[], from: number): number { let total = 0; for (let i = from; i >= 0; i--) { total = total * 2 + (values[i] ?? 0); if (total > 1e6) break; } return total; }
function downPast(values: number[], from: number): string { let text = ""; for (let i = from; i > from - 5; i--) text += values[i] + "|"; return text; }
function store(values: number[], from: number, value: any): void { for (let i = from; i < from + 3; i++) { values[i] = value; if (values[i] !== values[i]) values[i] = -1; } }
function twice(values: number[], from: number): string { let text = ""; for (let i = from; i < from + 3; i++) { const a = values[i]; const b = values[i]; text += (a === b || (a !== a && b !== b)) + ":" + a + "|"; } return text; }
function changing(values: number[], from: number): string { let text = ""; for (let i = from; i < from + 3; i++) { const a = values[i]; (values as any)["-1"] = i; if (i === from + 1) values.length = 2; const b = values[i]; text += a + ":" + b + "|"; } return text; }
function steps(values: number[], from: number, by: number): number { let total = 0; for (let i = from; i < values.length && total < 1e9; i += by) total = total * 3 + (values[i] || 1); return total; }
function nested(values: number[], from: number): number { let total = 0; for (let i = from; i < values.length; i++) for (let k = i; k < values.length; k++) total += values[k] > values[i] ? 1 : 0; return total; }
function text(string: string, from: number): string { let out = ""; for (let i = from; i < from + 4; i++) out += string[i] + string.charCodeAt(i); return out; }
function bytes(view: Uint8Array, from: number): number { let total = 0; for (let i = from; i < from + 4; i++) total = total * 2 + (view[i] ?? 7); return total; }
const starts = [0, 1, 3, 8, 100, -1, -2, -5, 2147483645, 2147483647, 2147483648, 4294967293, 4294967295, 9007199254740990, 9007199254740992, -2147483648, -2147483650];
const odd = [0.5, -0, NaN, Infinity, -Infinity, 2.75, -1.5, "2", null, undefined, true];
for (let round = 0; round < 3; round++) {
  for (const make of [int32s, doubles, holes, named, mixed]) {
    for (const from of starts) {
      const list = make() as number[];
      if (from > 9e15) { show(sum(list, from), bounds(list, from)); continue; }
      show(sum(list, from), bounds(list, from), from > 1e6 ? 0 : down(list, from), downPast(list, from), twice(list, from));
      if (Math.abs(from) < 1000) { show(steps(list, from < -10 ? 0 : from, 2), from < -10 ? 0 : nested(list, from), changing(make() as number[], from)); const stored = make() as number[]; store(stored, from, from); show(stored.length, Object.keys(stored).join(" ")); store(stored, from, NaN); show(stored.length, stored); store(stored, from, "s"); show(stored); }
      show(text("abcdéf日", from), bytes(new Uint8Array([1, 2, 3, 250]), from));
    }
    for (const from of odd as any[]) { const list = make() as number[]; if (from !== -Infinity && from !== Infinity) show(sum(list, from), bounds(list, from), twice(list, from === -Infinity ? 0 : from)); show(text("xyz", from === -Infinity || from === Infinity ? 0 : from)); }
  }
}
let state = 7, check = 0;
for (let i = 0; i < 400; i++) { state = (state * 16807) % 2147483647; const list = state % 3 ? int32s() : doubles(); check = (check * 31 + sum(list, (state % 14) - 2) + bounds(list, state % 9).high) % 1000003; }
show(check);
console.log(log.length, log);
