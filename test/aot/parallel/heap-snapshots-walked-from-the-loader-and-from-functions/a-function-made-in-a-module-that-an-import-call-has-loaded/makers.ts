// The body runs, and no variable of the module holds an object.
(globalThis as any).makersHaveRun = 1;
export function makeAdder(n: number) { return (m: number) => n + m; }
