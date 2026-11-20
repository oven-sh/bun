const held: any = {};
held[JSON.parse('"first"')] = function (this: any, depth: number) { this.below = new second(depth + 1); };
held[JSON.parse('"second"')] = function (this: any, depth: number) { this.below = new first(depth + 1); };
const first = held[JSON.parse('"first"')];
const second = held[JSON.parse('"second"')];
let answer: string;
try { answer = typeof new first(JSON.parse("0")); } catch (error: any) { answer = error.constructor.name; }
console.log(answer, typeof first, typeof second);
