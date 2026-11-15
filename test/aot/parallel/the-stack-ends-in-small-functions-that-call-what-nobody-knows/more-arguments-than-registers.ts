const held: any = {};
held[JSON.parse('"first"')] = (depth: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number) => 1 + second(depth + 1, b, c, d, e, f, g, h, i, j);
held[JSON.parse('"second"')] = (depth: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number) => 1 + first(depth + 1, b, c, d, e, f, g, h, i, j);
const first = held[JSON.parse('"first"')];
const second = held[JSON.parse('"second"')];
let answer: string;
try { answer = String(first(JSON.parse("0"), 2, 3, 4, 5, 6, 7, 8, 9, 10)); } catch (error: any) { answer = error.constructor.name; }
console.log(answer, typeof first, typeof second);
