export class A { constructor() { this.x = 1; } }
export class K extends A { constructor() { super(); this.y = 2; } }
const o = new K();
export const read = () => o;
