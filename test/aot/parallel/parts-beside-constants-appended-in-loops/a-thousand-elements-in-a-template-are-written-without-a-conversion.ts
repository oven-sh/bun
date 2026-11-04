// `line += `${c},``: c is written a number: no string is made of it
// COUNT: operation:operationAOTToString <= 20
function shape(list: number[]): string { let line = ""; for (const c of list) line += `${c},`; return line; }
(globalThis as any).kept = shape;
const list: number[] = []; for (let i = 0; i < 1000; i++) list.push(i);
console.log(shape(list).length, shape([0.5, -0, 2 ** 31, -1, NaN]));
