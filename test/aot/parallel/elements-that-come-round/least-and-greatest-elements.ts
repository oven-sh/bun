// STATISTIC: InvariantNumberGuardsHoisted >= 3
// A value of unknown type enters a loop where only elements of a list, or numbers made of them, come round: the least and the greatest of a list, its last element, a running mean.
function shown(x: unknown): string { return typeof x === "number" ? (Object.is(x, -0) ? "-0" : String(x)) : typeof x === "symbol" ? "symbol" : typeof x === "bigint" ? `${x}n` : typeof x === "object" && x !== null ? "object" : `${typeof x}:${String(x)}`; }
const late = process.argv.length > 99 ? 1 : 0;
function veil(x: any): any { const all: any[][] = [[x], [0]]; return all[late]![0]; }

const spread = (list: number[]): string => { let least = list[0]!, greatest = list[0]!; for (let i = 1; i < list.length; i++) { least = Math.min(least, list[i]!); greatest = Math.max(greatest, list[i]!); } return `${shown(least)} ${shown(greatest)}`; };
const least = (list: number[], start: any): string => { let found = start; for (let i = 0; i < list.length; i++) if (list[i]! < found) found = list[i]!; return shown(found); };
const last = (list: number[], start: any): string => { let found = start; for (const x of list) found = x; return shown(found); };
const mean = (list: number[], start: any): string => { let found = start; for (let i = 0; i < list.length; i++) found = found * 0.5 + list[i]!; return shown(found); };
const named = (list: number[], start: any): string => { let found = start; for (let i = 0; i < list.length; i++) { found = list[i]!; if (found === 4) found = "four" as any; } return shown(found); };
const swapped = (list: number[], start: any): string => { let one = start, other = 1; for (let i = 0; i < list.length; i++) { const kept = one; one = other; other = kept; } return `${shown(one)} ${shown(other)}`; };

const lists = (): any[] => [[3, 1, 4, 1, 5], [2.5, -0, 0.5, NaN], [-0], [], [1, , 3], [1, "b", 3], [5, 2.5, undefined], [1n, 2n], [{ valueOf() { return 2; } }, 1], Array.from({ length: 40 }, (_, k) => (k * 7) % 11), Array.from({ length: 40 }, (_, k) => k / 4 - 3)];
const starts = (): any[] => [undefined, null, 0, -0, 1.5, NaN, Infinity, "7", "x", true, 10n, { valueOf() { return 4; } }, [2], Symbol.iterator];
for (let l = 0; l < lists().length; l++) {
  const tried = (f: () => string): string => { try { return f(); } catch (error) { return `threw ${(error as Error).constructor.name}`; } };
  console.log(l, tried(() => spread(veil(lists()[l]))));
  for (let s = 0; s < starts().length; s++) {
    const start = () => veil(starts()[s]);
    console.log(l, s, [least, last, mean, named, swapped].map(f => tried(() => f(veil(lists()[l]), start()))).join(" "));
  }
}
