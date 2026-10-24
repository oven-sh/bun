// `const a = []; for (let i = 0; i < n; i++) a[i] = x`: the literal is born with the room the loop will fill, as one that is pushed to is; an array that was born elsewhere grows once, by the turns the loop has left. What the arrays hold is held to plain Bun; how often the run time is asked is counted.
declare const console: { log(...values: unknown[]): void };
declare const aotOperationCount: undefined | ((name: string) => number);
const counted = typeof aotOperationCount === "function" ? aotOperationCount : null;
const asked = () => (counted ? counted("operationAOTArrayPut") : 0);
const word = "w" + (counted ? "" : "");
const thing = { a: 1 };
function numbers(n: number): number[] { const a: number[] = []; for (let i = 0; i < n; i++) a[i] = i; return a; }
function halves(n: number): number[] { const a: number[] = []; for (let i = 0; i < n; i++) a[i] = i + 0.5; return a; }
function strings(n: number): string[] { const a: string[] = []; for (let i = 0; i < n; i++) a[i] = word + i; return a; }
function objects(n: number): { a: number }[] { const a: { a: number }[] = []; for (let i = 0; i < n; i++) a[i] = thing; return a; }
function anything(n: number): any { const a: any = []; for (let i = 0; i < n; i++) a[i] = i % 3 ? word : i; return a; }
function atItsLength(n: number): number[] { const a: number[] = []; for (let i = 0; i < n; i++) a[a.length] = i; return a; }
function everyOther(n: number): string[] { const a: string[] = []; let k = 0; for (let i = 0; i < n; i++) if (i % 2) a[k++] = word + i; return a; }
function withHoles(n: number): number[] { const a: number[] = []; for (let i = 0; i < n; i++) a[i * 2] = i; return a; }
function backwards(n: number): number[] { const a: number[] = []; for (let i = n - 1; i >= 0; i--) a[i] = i; return a; }
function given(a: string[], n: number): string[] { for (let i = 0; i < n; i++) a[i] = word + i; return a; }
function mixed(n: number): unknown[] { const a: unknown[] = []; for (let i = 0; i < n; i++) a[i] = i < 3 ? i : i < 6 ? i + 0.5 : word; return a; }
function leftEarly(n: number): number[] { const a: number[] = []; for (let i = 0; i < n; i++) { if (i === 4) break; a[i] = i; } return a; }
function frozenOnTheWay(n: number): string { const a: number[] = []; try { for (let i = 0; i < n; i++) { if (i === 5) Object.freeze(a); a[i] = i; } } catch (e) { return (e as Error).constructor.name + " " + a.length; } return "stored " + a.length; }
function tell(name: string, most: number, make: () => unknown): void {
    for (let round = 0; round < 300; round++) make();
    const before = asked();
    let made: unknown;
    for (let round = 0; round < 100; round++) made = make();
    const times = asked() - before;
    console.log(name + ": " + JSON.stringify(made) + " " + (Array.isArray(made) ? made.length : "") + " " + (!counted || times <= most));
}
tell("numbers", 0, () => numbers(16));
tell("halves", 0, () => halves(16));
tell("strings", 0, () => strings(16));
tell("objects", 0, () => objects(16));
tell("anything", 0, () => anything(16));
tell("at its length", 0, () => atItsLength(16));
tell("sixty numbers", 0, () => numbers(60));
tell("sixty strings", 0, () => strings(60));
tell("every other", 300, () => everyOther(16));
tell("with holes", 1000, () => withHoles(9));
tell("backwards", 1000, () => backwards(9));
tell("an array that was given", 100, () => given([], 16));
tell("mixed", 1000, () => mixed(9));
tell("left early", 0, () => leftEarly(1000));
tell("frozen on the way", 1000, () => frozenOnTheWay(9));
