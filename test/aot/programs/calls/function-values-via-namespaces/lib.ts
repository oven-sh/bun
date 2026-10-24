export function apply(f: (n: number) => number, n: number) { return f(n); }
export function applyUntyped(f: any, n: any) { return f(n); }
export const holder = { step: (n: number) => n + 1 };
export function useHolder(n: number) { return holder.step(n); }
export let current = (n: number) => n + 100;
export function useCurrent(n: number) { return current(n); }
export function setCurrent(f: (n: number) => number) { current = f; }
export default { run(f: (n: number) => number, n: number) { return f(n); } };
