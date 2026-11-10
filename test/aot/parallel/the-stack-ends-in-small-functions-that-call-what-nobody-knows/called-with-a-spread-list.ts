const held: any = {};
held[JSON.parse('"first"')] = (...all: number[]) => 1 + second(...all);
held[JSON.parse('"second"')] = (...all: number[]) => 1 + first(...all);
const first = held[JSON.parse('"first"')];
const second = held[JSON.parse('"second"')];
let answer: string;
try { answer = String(first(JSON.parse("0"))); } catch (error: any) { answer = error.constructor.name; }
console.log(answer, typeof first, typeof second);
