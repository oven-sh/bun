// Stores under raw numbers into lists of every kind: keys that are no index, lists that refuse.
const say: string[] = [], S = (x: any): void => { say.push(Object.is(x, -0) ? "-0" : String(x)); }, un = (v: unknown): any => [v][JSON.parse("0")];
function put(a: number[], k: number, v: number | undefined): void { a[k] = v!; }
const KEYS: number[] = [0, 1, 4, 5, 7, -1, 1.5, NaN, -0, 2 ** 32, 2 ** 32 - 1, 2 ** 53, Infinity, 1e21];
for (let r = 0; r < 50; r++) for (const k of KEYS) for (const v of [7, 0.5, undefined, NaN, -0, 2 ** 31]) { const l: number[] = [1, 2, 3, 4, 5]; try { put(l, k, v); } catch (e) { S((e as Error).name); } if (r === 49) { S(l.length); S(Object.keys(l).join()); S(un(l)[String(k)]); } }
let h0 = 7; for (const c0 of say.join("|")) h0 = (Math.imul(h0, 31) + c0.charCodeAt(0)) | 0; console.log(say.length, h0, say.slice(0, 20).join());
export {};
