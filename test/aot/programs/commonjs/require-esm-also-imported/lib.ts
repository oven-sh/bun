export let count = 0;
export function bump(): number { return ++count; }
export class Thing { constructor(public n: number) {} twice() { return this.n * 2; } }
console.log("lib evaluated");
