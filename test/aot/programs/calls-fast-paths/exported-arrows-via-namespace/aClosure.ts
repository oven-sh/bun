let hookOfAClosure: () => number = () => 0;
export function setHook(fn: () => number): void { hookOfAClosure = fn; }
export function callHook(): number { let t = 0; for (let i = 0; i < 10; i++) t += hookOfAClosure(); return t; }
const base: number[] = [5];
function make(): void { const kept = base[0]; unrelated = () => kept; }
export let unrelated: () => number = () => -1;
export function prepare(): void { make(); }
