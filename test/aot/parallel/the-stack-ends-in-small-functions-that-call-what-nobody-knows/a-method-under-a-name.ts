const one: any = JSON.parse("{}");
const other: any = JSON.parse("{}");
one.step = (depth: number) => 1 + other.step(depth + 1);
other.step = (depth: number) => 1 + one.step(depth + 1);
let answer: string;
try { answer = String(one.step(JSON.parse("0"))); } catch (error: any) { answer = error.constructor.name; }
console.log(answer, typeof one.step, typeof other.step);
