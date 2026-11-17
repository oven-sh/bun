// `new Array(0)` and `Array(0)` grow as `[]` does, whatever is pushed, stored by index or spliced in.
const hide = <T>(x: T): T => (globalThis as any).never ? (undefined as any) : x;
function pushed(x: unknown) { const l = new Array(0); for (let i = 0; i < 9; i++) l.push(typeof x === "number" ? x + i : String(x) + i); return l; }
function called(x: unknown) { const l = Array(0); for (let i = 0; i < 9; i++) l.push(typeof x === "number" ? x + i : String(x) + i); return l; }
function byIndex(x: number) { const l = new Array(0); for (let i = 0; i < 9; i++) l[i] = x * i; return l; }
function withGap(x: number) { const l = new Array(0); l[3] = x; l.push(x + 1); return l; }
function whole(x: number) { const l: number[] = new Array(0); for (let i = 0; i < 7; i++) l[i] = Math.floor(x * i); l[7] = Infinity; return l; }
function spliced(x: number) { const l = new Array(0); l.splice(0, 0, x, x + 1, x + 2, x + 3, x + 4, x + 5); l.length = 4; l.unshift(x - 1); return l; }
for (const x of [1, 0.5, "t", -0, 2 ** 31]) console.log(JSON.stringify(pushed(hide(x))), JSON.stringify(called(hide(x))));
for (const x of [1, 0.5, -0, 2 ** 31, NaN]) console.log(JSON.stringify(byIndex(hide(x))), JSON.stringify(withGap(hide(x))), 2 in withGap(hide(x)), JSON.stringify(whole(hide(x))), JSON.stringify(spliced(hide(x))));
let all = 0; for (let t = 0; t < 3000; t++) all += pushed(t).length + byIndex(t)[8] + whole(t + 0.5)[6] + spliced(t).length; console.log(all);
