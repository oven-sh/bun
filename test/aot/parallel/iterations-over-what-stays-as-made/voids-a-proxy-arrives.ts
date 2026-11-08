function total(list: number[]): number { let sum = 0; for (const item of list) sum += item; return sum; }
function firstTwo(list: number[]): string { const [first, second] = list; return first + "," + second; }
function copy(list: number[]): number[] { return [0, ...list]; }
function all(list: number[]): string { return total(list) + " " + firstTwo(list) + " " + copy(list).join(); }
function make(from: number): number[] { const made: number[] = []; for (let i = 0; i < 4; i++) made.push(from + i); return made; }

let asked = 0; let out = ""; for (let round = 0; round < 30; round++) { const list = round >= 27 ? new Proxy(make(round), { get(target, key, receiver) { asked++; return Reflect.get(target, key, receiver); } }) : make(round); out += all(list) + ";"; } console.log(out.slice(-160), asked);
