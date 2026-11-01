export const PI = 3.14159;
export let counter = 0;
export function increment(): void {
  counter++;
}
export function area(radius: number): number {
  return PI * radius * radius;
}
export interface Point {
  x: number;
  y: number;
}
export default function greet(name: string): string {
  return "hello " + name;
}
