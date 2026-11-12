// The same where the program says what the list holds and the list holds more: written numbers, a union, and what is stored while it is searched again and again.
const hidden = <T>(value: unknown): T => { (globalThis as any).handedOn = value; return (globalThis as any).handedOn as T; };
function find(list: (number | string | null)[], value: number): string { let s = ""; for (let i = 0; i < 3; i++) s += list.indexOf(value + i) + (list.includes(value + i) ? "y" : "n"); return s; }
function numbers(list: number[], value: number): number { return list.indexOf(value) * 10 + (list.includes(value) ? 1 : 2); }
const half = JSON.parse("0.5") as number, mixed: (number | string | null)[] = ["a", 1, null, 2, "3", 3];
console.log(find(mixed, 1), find(mixed, 0), find(hidden(["a", half * 2, 2.5, 3]), 1), find(hidden([half, 1, 2]), 1), find(hidden(["a"]), 0));
console.log(numbers([1, 2, 3], 2), numbers(hidden(["x", 2]), 2), numbers(hidden([undefined, 2, half * 4]), 2), numbers(hidden([half * 4, 2]), 2), numbers([], 0));
const growing: any[] = ["x"]; let told = ""; for (let i = 0; i < 40; i++) { growing.push(i % 3 === 2 ? i + half : i); told += growing.indexOf(i) + (growing.includes(i - 1) ? "y" : "n") + ","; if (i === 20) growing[5] = "gone"; if (i === 30) delete growing[7]; } console.log(told, growing.indexOf(4), growing.indexOf(6));
export {};
