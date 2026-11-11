const held: any = {};
held[JSON.parse('"first"')] = (depth: number, missing?: number, alsoMissing?: number) => 1 + second(depth + 1) + (missing ?? 0) + (alsoMissing ?? 0);
held[JSON.parse('"second"')] = (depth: number, missing?: number, alsoMissing?: number) => 1 + first(depth + 1) + (missing ?? 0) + (alsoMissing ?? 0);
const first = held[JSON.parse('"first"')];
const second = held[JSON.parse('"second"')];
let answer: string;
try { answer = String(first(JSON.parse("0"))); } catch (error: any) { answer = error.constructor.name; }
console.log(answer, typeof first, typeof second);
