// STATISTIC: LoopsBuiltForListsAndForBytes >= 1
// Nothing is known and nothing is expected of `c`; the turn computes with its elements. The loop asks in front for a list of numbers, a Buffer and a Uint8Array.
const key: string = JSON.parse('"go"');
const crc: Record<string, (c: any) => number> = { go(c: any): number { let h = 7; for (let i = 0; i <= c.length; i++) h = (h * 31 + c[i]) | 0; return h; } };
const put: Record<string, (c: any) => string> = { go(c: any): string { for (let i = 0; i < c.length; i++) c[i] = (c[i] * 3 + 300) & 1023; return Array.prototype.join.call(c); } };
const field: Record<string, (o: any) => number> = { go(o: any): number { const c = o.data; let h = 0; for (let i = 0; i < c.length; i++) h = (h ^ c[i]) >>> 1; return h; } };
const given: any[] = [JSON.parse("[1,2,3]"), JSON.parse("[0.5,1.5,-0]"), JSON.parse('[1,"2",null]'), [1, , 3], [], new Uint8Array([1, 2, 3]), Buffer.from([4, 5, 6]), new Uint8ClampedArray([7, 8]), new Int8Array([-1, 2]), new Uint32Array([4294967295, 1]), new Float64Array([0.5, NaN]), { length: 2, 0: 5, 1: 6 }, Object.freeze([1, 2])];
for (const c of given) for (let turn = 0; turn < 3; turn++) { let said: string; try { said = crc[key]!(c) + " " + field[key]!({ data: c }) + " " + put[key]!(c); } catch (e) { said = (e as Error).name; } console.log(said); }
console.log(crc[key]!("abc"), field[key]!({ data: "abc" }));
