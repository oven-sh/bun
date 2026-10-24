export interface Point {
  x: number;
  y: number;
}

export function plusOne(n: number): number {
  return n + 1;
}

export function sum(p: Point): number {
  return p.x + p.y;
}

export function size(s: string): number {
  return s.length;
}

export function total(numbers: number[]): number {
  let result = 0;
  for (const n of numbers) result += n;
  return result;
}

export function twice(f: (n: number) => number): number {
  return f(f(1));
}

export class Meter {
  value: number;
  constructor(start: number) {
    this.value = start;
  }
  add(by: number): number {
    this.value += by;
    return this.value;
  }
  static zero(): Meter {
    return new Meter(0);
  }
}

export const origin: Point = { x: 0, y: 0 };
export const sizes: number[] = [1, 2, 3];
export let counter = 0;

export function bump(): number {
  return ++counter;
}

export function report(): string {
  return JSON.stringify([origin, sum(origin), sizes, total(sizes)]);
}
