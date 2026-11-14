import { add, twice, both, between, inFrontOfItsArguments, inTurns, made, Box } from "./library";
export function outside(n: number): string { return [add(n, 1), twice(n), both(n), made(n), new Box(n).grow(2)].join(); }
export function outsideBetween(step: () => void, n: number): number { const first = add(n, 1); step(); return first * 1000 + add(n, 1); }
export function outsideInTurns(rounds: number, at: number, step: () => void): number { let sum = 0; for (let turn = 0; turn < rounds; turn++) { if (turn === at) step(); sum += add(turn, 1) + twice(turn); } return sum; }
export { between, inFrontOfItsArguments, inTurns };
