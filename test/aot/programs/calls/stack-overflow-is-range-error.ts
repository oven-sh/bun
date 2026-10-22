// A real stack overflow is still a RangeError that can be caught.
// ENV JSC_aotCountsPath=/dev/null
declare const console: any;
declare const aotOperationCount: (name: string) => number;
let deepest = 0;
function down(n: number, x: number): number { deepest = n; return down(n + 1, x + 0.5) + 1; }
function left(n: number): number { return right(n + 1) + 1; }
function right(n: number): number { return left(n + 1) + 1; }
function attempt(run: () => number): string {
    try { return "returned " + run(); } catch (error) { return (error instanceof RangeError) + " " + (error as Error).message; }
}
console.log("a recursion without an end:", attempt(() => down(0, 0)));
console.log("it went deep:", deepest > 1000);
console.log("two functions that call each other:", attempt(() => left(0)));
console.log("again, behind the first:", attempt(() => down(0, 0)));
function fib(n: number): number { return n < 2 ? n : fib(n - 1) + fib(n - 2); }
console.log("and what ends, ends:", fib(20));
console.log("the poll at an entry was entered:", aotOperationCount("operationAOTPollAtPrologue") > 0);
