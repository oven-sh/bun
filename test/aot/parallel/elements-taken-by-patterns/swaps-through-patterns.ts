// Stores through array patterns whose right side is a literal of elements: swaps, rotations of three, two lists; lists of every storage, frozen lists, lists that grow or are cut between.
function shown(x: any): string { return Array.isArray(x) || x instanceof Float64Array ? `[${x.length}:${Array.from({ length: x.length }, (_, i) => (i in x ? shown(x[i]) : "hole")).join(",")}]` : typeof x === "number" ? (Object.is(x, -0) ? "-0" : String(x)) : typeof x === "object" && x !== null ? "object" : `${typeof x}:${String(x)}`; }
const late = process.argv.length > 99 ? 1 : 0;
function veil(x: any): any { const all: any[][] = [[x], [0]]; return all[late]![0]; }

const reversed = (list: number[]): string => { for (let i = 0, k = list.length - 1; i < k; i++, k--) [list[i], list[k]] = [list[k]!, list[i]!]; return shown(list); };
const bubbled = (list: number[]): string => { for (let i = 0; i + 1 < list.length; i++) if (list[i]! > list[i + 1]!) [list[i], list[i + 1]] = [list[i + 1]!, list[i]!]; return shown(list); };
const rotated = (list: number[]): string => { for (let i = 0; i + 2 < list.length; i += 3) [list[i], list[i + 1], list[i + 2]] = [list[i + 1]!, list[i + 2]!, list[i]!]; return shown(list); };
const exchanged = (list: number[], other: number[]): string => { for (let i = 0; i < list.length && i < 40; i++) [list[i], other[i]] = [other[i]!, list[i]!]; return `${shown(list)} ${shown(other)}`; };
const shuffled = (list: number[]): string => { let r = 12345; for (let i = list.length - 1; i > 0; i--) { r = (r * 1103 + 12345) % 65521; const k = r % (i + 1); [list[i], list[k]] = [list[k]!, list[i]!]; } return shown(list); };
const cut = (list: number[]): string => { for (let i = 0, k = list.length - 1; i < k; i++, k--) { [list[i], list[k]] = [list[k]!, list[i]!]; if (i === 1 && !Object.isFrozen(list)) list.length = 2; } return shown(list); };
const named = (list: number[]): string => { for (let i = 0; i + 1 < list.length; i++) [list[i], list[i + 1]] = [list[i + 1]!, (i === 2 ? "t" : list[i]!) as number]; return shown(list); };
const counted = (list: number[]): string => { let n = 0; for (let i = 0; i + 1 < list.length; i++) [list[i], n, list[i + 1]] = [list[i + 1]!, n + 1, list[i]!]; return `${shown(list)} ${n}`; };
const missing = (list: number[]): string => { for (let i = 0; i + 1 < list.length; i++) [list[i], list[i + 1]] = [list[i + 1]!] as any; return shown(list); };

const lists = (): any[] => [[3, 1, 4, 1, 5, 9], [2.5, -0, 0.5, NaN, 7], [1, , 3, 4], ["a", 1, {}, 2], [], [7], Array.from({ length: 24 }, (_, k) => (k * 7) % 11), Array.from({ length: 24 }, (_, k) => k / 4 - 3), [undefined, 1, null, 2], Object.freeze([4, 5, 6]), new Float64Array([1.5, 2, 3])];
for (let l = 0; l < lists().length; l++) {
  for (const f of [reversed, bubbled, rotated, shuffled, cut, named, counted, missing]) {
    const list = veil(lists()[l]);
    let answer: string;
    try { answer = f(list); } catch (error) { answer = `threw ${(error as Error).constructor.name} ${shown(list)}`; }
    console.log(l, answer);
  }
  for (const other of lists()) {
    const list = veil(lists()[l]);
    let answer: string;
    try { answer = exchanged(list, veil(other)); } catch (error) { answer = `threw ${(error as Error).constructor.name} ${shown(list)}`; }
    console.log(l, answer);
  }
}
