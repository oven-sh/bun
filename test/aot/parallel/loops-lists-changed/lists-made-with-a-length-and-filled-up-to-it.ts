// Lists made with a length and filled in a loop up to it, where something may change the length.
const out: string[] = [];
const show = (label: string, value: unknown) => out.push(`${label}: ${JSON.stringify(value)}`);
function squares(count: number): number[] { const list = new Array<number>(count); for (let k = 0; k < count; k++) list[k] = k * k; return list; }
function readsHoles(count: number): unknown[] { const list = new Array(count); const seen: unknown[] = []; for (let k = 0; k < count; k++) seen.push(list[k]); seen.push(list.length); return seen; }
function cutInLoop(count: number): number[] { const list = new Array<number>(count); for (let k = 0; k < count; k++) { list[k] = k; if (k === 1) list.length = 2; } return list; }
function cutBefore(count: number): number[] { const list = new Array<number>(count); list.length = 1; for (let k = 0; k < count; k++) list[k] = k; return list; }
function pushed(count: number): number[] { const list = new Array<number>(count); list.push(9); for (let k = 0; k < list.length; k++) list[k] = k; return list; }
function handed(count: number, cut: (l: number[]) => void): number[] { const list = new Array<number>(count); cut(list); for (let k = 0; k < count; k++) list[k] = k; return list; }
function lengths(count: number): number[] { const list = new Array<number>(count); const a = list.length; list[count + 2] = 1; return [a, list.length]; }
function wrongLength(n: number): string { try { return String(new Array(n).length); } catch (e) { return (e as Error).constructor.name; } }
for (const n of [0, 1, 3, 20]) show("squares " + n, squares(n));
show("reads holes", readsHoles(3)); show("cut in loop", cutInLoop(4)); show("cut before", cutBefore(3)); show("pushed", pushed(2));
show("handed", handed(4, l => { l.length = 1; })); show("lengths", lengths(2));
show("wrong", [wrongLength(-1), wrongLength(1.5), wrongLength(4294967295), wrongLength(2)]);
show("after", squares(2));
console.log(out.join("\n"));
