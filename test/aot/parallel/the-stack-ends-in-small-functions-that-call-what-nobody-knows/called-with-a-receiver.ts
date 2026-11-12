const held: any = {};
const nameOfFirst = JSON.parse('"first"');
const nameOfSecond = JSON.parse('"second"');
held[nameOfFirst] = function (this: any, depth: number) { return 1 + this[nameOfSecond](depth + 1); };
held[nameOfSecond] = function (this: any, depth: number) { return 1 + this[nameOfFirst](depth + 1); };
let answer: string;
try { answer = String(held[nameOfFirst](JSON.parse("0"))); } catch (error: any) { answer = error.constructor.name; }
console.log(answer, typeof held.first, typeof held.second);
