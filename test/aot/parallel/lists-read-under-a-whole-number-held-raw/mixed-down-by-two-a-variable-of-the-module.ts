function show(x: unknown): string { return typeof x === "object" && x ? "{" + (x as any).n + "}" : typeof x + ":" + String(x); }
const list: any[] = [1, "b", { n: 2 }, 3.5, undefined];
(list as any)[-1] = "minus one"; (list as any)[-2] = "minus two"; (list as any)[4294967295] = "the last that is no index"; (list as any)[4294967296] = "past uint32"; (list as any)[4294967297] = "past uint32 by one";
(globalThis as any).kept = list;
let count = 0;
function step(): void { count++; }
function back(): void { count--; }
function leap(): void { count += 1073741824; }
function fall(): void { count -= 1073741824; }
function read(): string { let s = ""; for (let i = count; i >= count - 6; i -= 2) s += show(list[i]) + ","; return s; }
const api = { step, back, leap, fall, read };
for (let k = 0; k < 7; k++) { console.log(api.read()); api.step(); }
for (let k = 0; k < 10; k++) { api.back(); console.log(api.read()); }
for (let k = 0; k < 3; k++) api.step();
for (let k = 0; k < 4; k++) { api.leap(); console.log(api.read()); api.step(); console.log(api.read()); }
for (let k = 0; k < 9; k++) { api.fall(); console.log(api.read()); }
