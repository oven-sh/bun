const nothing = null;
function late(): number { return below.size; }
function wrap(size: number): { size: number } { return { size }; }
function loop(from: number[]): number[] { const out: number[] = []; for (const x of from) out.push(x + late()); return out; }
function withDefault(size: number = late()): { size: number } { return { size }; }
class Sized { size: number; constructor() { this.size = late(); } }
class WithField { size = late(); }
export const made = wrap(late());
const below = { size: 1 };
