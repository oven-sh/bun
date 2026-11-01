// Code that runs seldom reads a field by name from a value of unknown type. The table of fields answers for a field that holds -1 or 1 as it does for any integer of 32 bits, so the run time is not asked.
// Flags: --aot-heat=EverythingIsCold
// COUNT: operation:operationAOTGetByIdAndCache = 0
const key = process.env.SHELF || "shelf";
const few = process.argv.length;
const anything: any = few > 50 ? { shelf: 0 } : globalThis;
type Down = { sign: -1; depth: number };
type Up = { sign: 1; height: number; weight: number };
type Step = Down | Up;
function worth(step: Step): number {
  return step.sign === -1 ? -step.depth : step.height * step.weight;
}
function put(x: Step) {
  anything[key] = x;
}
function take(depth: number): any {
  return depth ? take(depth - 1) : anything[key];
}
const first: Step = few > 50 ? { sign: -1, depth: few } : { sign: 1, height: few, weight: 3 };
const second: Step = few > 50 ? { sign: 1, height: few, weight: 3 } : { sign: -1, depth: few };
let sum = worth(first) + worth(second);
put(first);
for (let i = 0; i < 500; i++) sum += take(0).sign;
put(second);
for (let i = 0; i < 500; i++) sum += take(0).sign;
console.log(sum);
