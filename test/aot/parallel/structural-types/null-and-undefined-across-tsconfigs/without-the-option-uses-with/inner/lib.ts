export class Point {
  x: number;
  y: number;
  label: string = "p";
  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
  }
  sum(): number {
    return this.x + this.y;
  }
}
export function addOne(n: number): number {
  return n + 1;
}
export function bits(n: number): number {
  return (n | 0) + (n >>> 1);
}
export function size(s: string): number {
  return s.length;
}
export function shout(s: string): string {
  return s + "!";
}
export function not(b: boolean): boolean {
  return !b;
}
export function describe(p: Point): string {
  return p.label + ":" + p.sum();
}
export function sum(list: number[]): number {
  let result = 0;
  for (const n of list) result += n;
  return result;
}
export function sumByIndex(list: number[]): number {
  let result = 0;
  for (let i = 0; i < list.length; i++) result += list[i]!;
  return result;
}
export function first<T>(list: T[]): T | undefined {
  return list[0];
}
export class Box<T> {
  constructor(public value: T) {}
  map<U>(change: (value: T) => U): Box<U> {
    return new Box(change(this.value));
  }
}
export function orDefault(n: number | undefined): number {
  return n === undefined ? -1 : n;
}
export function isNull(n: number | null): boolean {
  return n === null;
}
export function lengthOrZero(s?: string): number {
  return s === undefined ? 0 : s.length;
}
export const registry: Map<string, number> = new Map();
export function totalOfRegistry(): number {
  let result = 0;
  for (const value of registry.values()) result += value;
  return result;
}
export const numbers: number[] = [1.5, 2.5];
export const origin = new Point(0, 0);
export function maybe(flag: boolean): number | null {
  return flag ? 1 : null;
}
export function apply(change: (n: number) => number, n: number): number {
  return change(n) + 1;
}
