function outer(run: (f: (skip: boolean) => number) => number): number { const early = run(a); const list = [1, 2, 3]; return early + a(false); function a(skip: boolean) { return walk(skip); } function walk(skip: boolean) { return skip ? 0 : list.length; } }
let answer: unknown;
try { answer = outer(f => f(true)); } catch (e: any) { answer = e.constructor.name; }
console.log(answer);
