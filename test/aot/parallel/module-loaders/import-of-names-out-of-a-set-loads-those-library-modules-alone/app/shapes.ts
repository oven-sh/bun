export const unread = { a: 1, b: [1, 2, 3] };
export const alsoUnread = "never read " + unread.a;
export function makeCounter(start: number) {
  let value = start;
  return { next: () => ++value, reset: () => { value = start; } };
}
export class Shape {
  constructor(public sides: number) {}
  area() { return this.sides * 2; }
}
export class NeverMade extends Shape {
  area() { return 0; }
}
let total = 0;
export function add(n: number) { total += n; return total; }
export function neverCalled(text: string) { return "NEVER-CALLED-" + text.toUpperCase(); }
export const pattern = /a+b/;
