export function add(a: number, b: number): number { return a + b; }
export const twice = (n: number): number => n * 2;
export class Box { size: number; constructor(n: number) { this.size = n; } grow(by: number): number { this.size += by; return this.size; } }
export function both(n: number): number { return add(n, 1) + twice(n); }
export function between(step: () => void, n: number): number { const first = add(n, 1); step(); return first * 1000 + add(n, 1); }
export function inFrontOfItsArguments(lay: () => number): number { return add(lay(), 1); }
export function inTurns(rounds: number, at: number, step: () => void): number { let sum = 0; for (let turn = 0; turn < rounds; turn++) { if (turn === at) step(); sum += add(turn, 1) + twice(turn); } return sum; }
export function made(n: number): number { return new Box(n).grow(1); }
