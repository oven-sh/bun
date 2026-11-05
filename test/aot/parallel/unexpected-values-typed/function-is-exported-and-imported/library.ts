export interface Point {
  x: number;
  y: number;
}

export function total(list: number[]): number {
  let sum = 0;
  for (let i = 0; i < list.length; i++) sum += list[i];
  return sum;
}

export const sum = (p: Point): number => p.x + p.y;

export default function code(s: string): number {
  return s.charCodeAt(0) + s.length;
}

export class Scale {
  constructor(public factor: number) {}
  apply(n: number): number {
    return n * this.factor;
  }
}

function half(n: number): number {
  return n / 2;
}

export { half as halved };

export function insideTheLibrary(): number {
  return total([1, 2]) + sum({ x: 1, y: 2 }) + code("a") + half(4) + new Scale(2).apply(3);
}
