import { log } from "./log";
type Cell = { filled: object | null };
let step = 1;
export function setStep(next: number): void { step = next; }

function withArrows(): { rounds: number } {
  const earlier: Array<() => Cell> = [];
  let rounds = 0;
  for (const round of [1, 2]) {
    const cell: Cell = { filled: null };
    for (const get of earlier) { if (get().filled) log.push("arrow"); }
    earlier.push(() => cell);
    cell.filled = {};
    rounds += round;
  }
  return { rounds };
}
export const byArrow = withArrows();

function withDeclarations(): { rounds: number } {
  const earlier: Array<() => Cell> = [];
  let rounds = 0;
  for (const round of [1, 2]) {
    const cell: Cell = { filled: null };
    function mine(): Cell { return cell; }
    for (const get of earlier) { if (get().filled) log.push("declaration"); }
    earlier.push(mine);
    cell.filled = {};
    rounds += round;
  }
  return { rounds };
}
export const byDeclaration = withDeclarations();

function withLets(): { rounds: number } {
  const earlier: Array<() => object | null> = [];
  let rounds = 0;
  for (const round of [1, 2]) {
    let filled: object | null = null;
    for (const get of earlier) { if (get()) log.push("let"); }
    earlier.push(() => filled);
    filled = {};
    rounds += round;
  }
  return { rounds };
}
export const byLet = withLets();

function addsStep(): { total: number } {
  const earlier: Array<() => Cell> = [];
  let total = 0;
  for (const round of [1, 2]) {
    const cell: Cell = { filled: null };
    for (const get of earlier) { if (get().filled) total += step; }
    earlier.push(() => cell);
    cell.filled = {};
    total += round;
  }
  return { total };
}
export const readsStep = addsStep();
