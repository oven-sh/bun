// No variable of this module holds an object: its one function is only ever called, so it never becomes one.
export function makeAdder(n: number) { return (m: number) => n + m; }
