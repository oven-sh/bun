const held: any = {};
function one(depth: number) { return 1 + second(depth + 1); }
function other(depth: number) { return 1 + first(depth + 1); }
(one as any)[JSON.parse('"mark"')] = 1;
(other as any)[JSON.parse('"mark"')] = 2;
held[JSON.parse('"first"')] = one;
held[JSON.parse('"second"')] = other;
const first = held[JSON.parse('"first"')];
const second = held[JSON.parse('"second"')];
let answer: string;
try { answer = String(first(JSON.parse("0"))); } catch (error: any) { answer = error.constructor.name; }
console.log(answer, typeof first, typeof second);
