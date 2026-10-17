export const first = { a: 1, b: "x" };
export const turned = { b: "y", a: 2 };
export function make(n: number) { return { a: n, b: "made" + n } }
export const nested = { p: { a: 3, b: "n" }, q: [{ a: 4, b: "l" }] };
export const holdsFunction = { a: 5, run: () => "other" };
