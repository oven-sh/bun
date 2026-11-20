const stamps: number[] = []; for (let i = 0; i < 12; i++) stamps.push(1000 + (i % 3));
const when = new Date(1000);
function count(from: number): number { let n = from; for (let i = 0; i < stamps.length; i++) { if (stamps[i] === when.getTime()) n++; when.setTime(1000 + ((i * 2) % 3)); } return n; }
(globalThis as any).kept = count;
console.log(count(0), count(100));
