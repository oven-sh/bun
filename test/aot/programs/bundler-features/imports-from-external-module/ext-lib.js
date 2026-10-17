export default "default export";
export function add(a, b) { return a + b; }
export let counter = 0;
export function bump() { counter++; }
export class Thing { constructor(n) { this.n = n; } twice() { return this.n * 2; } }
