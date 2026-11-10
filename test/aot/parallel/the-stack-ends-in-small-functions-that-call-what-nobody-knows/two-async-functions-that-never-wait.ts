const held: any = {};
let entered = 0;
held[JSON.parse('"first"')] = async (depth: number) => { const below = second(depth + 1); entered++; return below; };
held[JSON.parse('"second"')] = async (depth: number) => { const below = first(depth + 1); entered++; return below; };
const first = held[JSON.parse('"first"')];
const second = held[JSON.parse('"second"')];
let answer: string;
try { answer = String(await first(JSON.parse("0"))); } catch (error: any) { answer = error.constructor.name; }
console.log(answer, entered > 1000, typeof first, typeof second);
