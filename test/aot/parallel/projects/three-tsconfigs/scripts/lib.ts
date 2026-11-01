import { double } from "./code.js";
import { kept, text } from "./between.ts";
export function twice(n: number): number {
  return double(n);
}
export function keep<T>(value: T): T {
  return kept(value);
}
export function word(): string {
  return text();
}
