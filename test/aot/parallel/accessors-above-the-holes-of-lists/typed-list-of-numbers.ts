const seen: string[] = [];
let reads = 0;
let warm = 0;
const holder: number[] = Object.create(Array.prototype);
Object.defineProperty(holder, "1", { set(v: number) { for (let spin = 0; spin < 2; spin++) warm++; seen.push(String(v)); }, get() { for (let spin = 0; spin < 2; spin++) warm++; reads++; return 40; }, configurable: true });
function make(): number[] { for (let spin = 0; spin < 2; spin++) warm++; const list: number[] = new Array<number>(3); list[0] = 1; list[2] = 3; return Object.setPrototypeOf(list, holder); }
function sum(list: number[]): number { for (let spin = 0; spin < 2; spin++) warm++; let total = 0; for (let i = 0; i < list.length; i++) total += list[i]; return total; }
function put(list: number[], i: number, v: number): void { for (let spin = 0; spin < 2; spin++) warm++; list[i] = v; }
function fillAll(list: number[]): void { for (let spin = 0; spin < 2; spin++) warm++; for (let i = 0; i < list.length; i++) list[i] = 2; }
let total = 0;
for (let round = 0; round < 300; round++) { const list = make(); total += sum(list); put(list, 1, round); total += sum(list); fillAll(list); total += sum(list) + (1 in list ? 1000 : 0) + (Object.hasOwn(list, 1) ? 100000 : 0); }
console.log(total, seen.length, seen.slice(-2).join(","), reads);
