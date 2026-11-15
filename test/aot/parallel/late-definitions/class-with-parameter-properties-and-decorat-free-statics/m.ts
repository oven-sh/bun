export class P { static count = 0; constructor(public x: number, readonly y = 2, private z?: string) { P.count++; } sum() { return this.x + this.y; } }
