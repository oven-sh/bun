const lamps = new Map<number, boolean>();
const odd: unknown[] = [true, false, 0, 1, "", "on", null, undefined, {}, [], NaN, -0, 0n, 3n, Symbol.iterator, () => false, new Boolean(false)];
for (let i = 0; i < odd.length; i++) lamps.set(i, odd[i] as boolean);
function lit(from: Map<number, boolean>, count: number) { let total = 0, marks = ""; for (let i = 0; i < count; i++) { const on: boolean = from.get(i)!; if (on) { total++; marks += "+"; } else marks += "-"; } return total + " " + marks; }
function flags(list: boolean[]) { let total = 0; for (let i = 0; i < list.length; i++) { if (list[i]) total++; } return total; }
console.log(lit(lamps, odd.length + 2));
console.log(lit(new Map([[0, true], [1, false], [2, true]]), 3));
console.log(flags([true, false, true, true]), flags(odd as boolean[]), flags([, true, , false] as boolean[]));
