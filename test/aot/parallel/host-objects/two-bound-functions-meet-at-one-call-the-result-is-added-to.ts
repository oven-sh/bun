const at: number[] = JSON.parse("[0,1,0,1]");
const floor = Math.floor.bind(null);
const letter = String.fromCharCode.bind(null);
function call(pick: number): number | string { let t = 0; for (let i = 0; i < 2; i++) t = (t + i) | 0; const f = pick ? letter : floor; return f(65.5); }
function show(list: number[]): string { let out = ""; for (let i = 0; i < list.length; i++) { const r: any = call(list[i]!); out += `${r + 1},`; } return out; }
console.log(show(at));
