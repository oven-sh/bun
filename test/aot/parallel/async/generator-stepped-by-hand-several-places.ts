// A generator that is stepped by calls of next() at several places of one function, with values sent in, with return() and throw() between the steps, and with a body that throws: the stack of the error names the step that ran the body.
declare const console: any;
function* naturals() { for (let k = 0; ; k++) yield k; }
function third(i: number): number { const numbers = naturals(); numbers.next(); numbers.next(); return numbers.next().value! + (i & 1); }
function* adder(): Generator<number, string, number> { let total = 0; for (let k = 0; k < 3; k++) total += yield total; return "sum " + total; }
function sent(i: number): string { const sums = adder(); const a = sums.next(0); const b = sums.next(i); const c = sums.next(2); const d = sums.next(3); const e = sums.next(4); return [a.value, b.value, c.value, d.value, d.done, e.value, e.done].join(" "); }
function* guarded() { try { yield 1; yield 2; yield 3; } finally { marks++; } }
let marks = 0;
function ended(): string { const steps = guarded(); const a = steps.next(); const b = (steps as any).return(9); const c = steps.next(); return [a.value, b.value, b.done, c.value, c.done, marks].join(" "); }
function thrownInto(): string { const steps = guarded(); steps.next(); try { steps.throw(new RangeError("in")); return "not reached"; } catch (e: any) { return e.constructor.name + " " + steps.next().done + " " + marks; } }
function* failing(limit: number) { for (let k = 0; ; k++) { if (k === limit) throw new Error("at " + k); yield k; } }
function lineOfStep(limit: number): string {
  const steps = failing(limit);
  try {
    steps.next();
    steps.next();
    steps.next();
    return "no error";
  } catch (e: any) {
    return e.message + ": " + String(e.stack).split("\n").slice(1, 3).map((line: string) => line.replace(/^.*?([A-Za-z]+) \(.*:(\d+):\d+\).*$/, "$1 $2")).join(", ");
  }
}
function* calling(f: (k: number) => number) { for (let k = 0; ; k++) yield f(k); }
function called(): string { const steps = calling(k => { if (k === 1) throw new TypeError("callback"); return k; }); const a = steps.next().value; try { steps.next(); return "not reached"; } catch (e: any) { return a + " " + e.message + " " + steps.next().done; } }
let total = 0;
for (let i = 0; i < 3000; i++) total += third(i);
console.log(total);
for (let i = 0; i < 3; i++) console.log(sent(i));
console.log(ended()); console.log(thrownInto());
for (let limit = 0; limit < 4; limit++) console.log(lineOfStep(limit));
console.log(called());
