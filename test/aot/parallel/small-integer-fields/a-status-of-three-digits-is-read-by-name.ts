// Code that runs seldom reads a field by name from a value of unknown type. The table of fields answers for a field that holds 200 or 404 as it does for any integer of 32 bits, so the run time is not asked.
// Flags: --aot-heat=EverythingIsCold
// COUNT: operation:operationAOTGetByIdAndCache = 0
const key = process.env.SHELF || "shelf";
const few = process.argv.length;
const anything: any = few > 50 ? { shelf: 0 } : globalThis;
type Found = { status: 200; seconds: number };
type Missing = { status: 404; seconds: number; tries: number };
type Answer = Found | Missing;
function worth(answer: Answer): number {
  return answer.status === 200 ? answer.seconds : answer.seconds * answer.tries;
}
function put(x: Answer) {
  anything[key] = x;
}
function take(depth: number): any {
  return depth ? take(depth - 1) : anything[key];
}
const first: Answer = few > 50 ? { status: 200, seconds: few } : { status: 404, seconds: few, tries: 2 };
const second: Answer = few > 50 ? { status: 404, seconds: few, tries: 2 } : { status: 200, seconds: few };
let sum = worth(first) + worth(second);
put(first);
for (let i = 0; i < 500; i++) sum += take(0).status;
put(second);
for (let i = 0; i < 500; i++) sum += take(0).status;
console.log(sum);
