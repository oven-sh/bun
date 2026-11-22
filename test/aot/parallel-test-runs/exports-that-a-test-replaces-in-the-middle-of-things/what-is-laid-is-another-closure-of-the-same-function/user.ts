import { add, counter, namer, counted } from "./library";
export function once(n: number): string { return [add(n, 1), counter(1), namer(), counted()].join(); }
export function inTurns(rounds: number): string { let sum = 0; let names = ""; for (let turn = 0; turn < rounds; turn++) { sum += add(turn, 1) + counter(1) + counted(); names = namer(); } return sum + " " + names; }
export function between(step: () => void): string { const first = counter(1) + namer(); step(); return first + " " + counter(1) + namer(); }
