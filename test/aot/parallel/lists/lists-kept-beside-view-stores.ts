// A list that is made in front of a loop stays known in its turns though they store into a view; what is stored into the list itself, or through another name, is seen.
const view = new Uint8Array(8);
let kept: number[] = [];
function pair(n: number): number { const two = [n, n + 2]; let sum = 0; for (let i = 0; i < 8; i++) { view[i] = two[0]; sum = (sum + two[1] + two.length) | 0; } return sum; }
function chosen(n: number): number { const three = [n, 2, 3]; let sum = 0; for (let i = 0; i < 8; i++) { view[i] = i + n; sum = (sum + three[0] + three[i & 1]) | 0; } return sum; }
function written(n: number): string { const three = [n, 2, 3]; let sum = 0; for (let i = 0; i < 8; i++) { view[i] = i; three[1] += view[i]; if (i === 5) three[0] = 100; sum += three[0] + three[1]; } return sum + ":" + three.join(); }
function grown(n: number): string { const some = [n]; for (let i = 0; i < 4; i++) { view[i] = some.length; some.push(view[i] + i); } return some.join() + ":" + some.length; }
function escaped(n: number): string { const some = [n, 7]; let sum = 0; for (let i = 0; i < 4; i++) { view[i] = i; if (i === 1) kept = some; if (i === 2) kept[0] = 50; sum += some[0] + some[1]; } return sum + ":" + some.join(); }
function boxed(n: number): number { const box = { two: [n, 1], b: n }; let sum = 0; for (let i = 0; i < 8; i++) { view[i & 7] = box.b; sum = (sum + box.two[0]) | 0; if (i === 4) box.two = [9, 9]; } return sum; }
function given(n: number): number { let sum = 0; for (let i = 0; i < 4; i++) { view[i] = n; sum += arguments.length * 10 + (arguments[0] as number) + view[0]; } return sum; }
function holed(n: number): string { const some = [n, , 3] as number[]; let seen = ""; for (let i = 0; i < 3; i++) { view[i] = 1; seen += String(some[i]) + some.length; if (i === 1) delete some[2]; } return seen; }
function aliased(n: number): number { const own = new Uint8Array(4); const same = new Uint8Array(own.buffer); const list = [n, n]; let sum = 0; for (let i = 0; i < 4; i++) { own[0] = i; same[0] = same[0] + 1; list[0] = own[0]; sum += list[0] * 10 + list[1]; } return sum; }
for (let n = 0; n < 4; n++) console.log(pair(n), chosen(n), written(n), grown(n), escaped(n), boxed(n), given(n), holed(n), aliased(n), view.join());
for (const n of [0.5, -0, NaN, 2147483647]) console.log(pair(n), chosen(n), written(n), escaped(n), boxed(n), aliased(n));
export {};
