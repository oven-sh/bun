declare const console: { log(...values: unknown[]): void };
import { seen } from "./generic-b";
export function first<T>(list: T[]): T | undefined;
export function first<T>(list: T[], otherwise: T): T;
export function first<T>(list: T[], otherwise?: T): T | undefined { return list.length ? list[0] : otherwise; }
export function replace(): void { (first as unknown) = <T>(list: T[]): T | undefined => list[list.length - 1]; }
console.log("generic", seen, first([1, 2]));
