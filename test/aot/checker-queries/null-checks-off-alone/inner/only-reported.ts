// What `strictNullChecks` only reports, and makes no type of, is asked of the file.
export function half(n: number): number { if (n < 0) return; return n / 2; }
export class Point { x: number; }
export class Early { y: number; constructor() { console.log(this.y); this.y = 1; } }
