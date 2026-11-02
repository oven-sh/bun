export class Point {
  x: number;
  y: number;
  label: string;
  next: Point;
  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
  }
  sum(): number {
    return this.x + this.y;
  }
}
export function numberOrNothing(flag: boolean): number {
  return flag ? 1.5 : undefined;
}
export function integerOrNull(flag: boolean): number {
  return flag ? 7 : null;
}
export function textOrNothing(flag: boolean): string {
  return flag ? "text" : undefined;
}
export function flagOrNull(flag: boolean): boolean {
  return flag ? true : null;
}
export function pointOrNothing(flag: boolean): Point {
  return flag ? new Point(1, 2) : undefined;
}
export function callWithNothing(callback: (n: number, s: string, p: Point, b: boolean) => string): string {
  return callback(undefined, null, undefined, null);
}
export function emptyFields(point: Point): void {
  point.x = undefined;
  point.y = null;
  point.label = undefined;
}
export function emptyPair(pair: { left: number; right: string }): void {
  pair.left = null;
  pair.right = undefined;
}
export function numbersWithGaps(): number[] {
  return [1.5, undefined, 2.5, null];
}
export function integersWithGaps(): number[] {
  return [1, null, 2, undefined];
}
export function pushNothing(list: number[]): void {
  list.push(undefined);
  list[0] = null;
}
export function textsWithGaps(): string[] {
  return ["a", undefined, null];
}
export function pick<T>(list: T[], index: number): T {
  return index < list.length ? list[index] : undefined;
}
export class Box<T> {
  value: T;
  constructor(value?: T) {
    this.value = value;
  }
  get(): T {
    return this.value;
  }
}
export const counts = new Map<string, number>([
  ["a", 1],
  ["b", undefined],
  ["c", null],
]);
export let total: number = undefined;
export const settings: { port: number; host: string } = { port: undefined, host: null };
export function later(flag: boolean): Promise<number> {
  return Promise.resolve(flag ? 3 : undefined);
}
