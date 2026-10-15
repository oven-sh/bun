import { basename } from "node:path";

export abstract class Shape {
  abstract readonly kind: string;
  abstract area(): number;
  toString(): string {
    return `${this.kind}:${this.area().toFixed(2)}`;
  }
}

export class Circle extends Shape {
  readonly kind: string = "circle";
  constructor(public radius: number) {
    super();
  }
  area(): number {
    return Math.PI * this.radius * this.radius;
  }
}

export class Square extends Shape {
  readonly kind: string = "square";
  constructor(public side: number) {
    super();
  }
  area(): number {
    return this.side * this.side;
  }
}

export const registry = new Map<string, Shape[]>();
export const kinds: string[] = [];
let sum = 0;

export function register(shape: Shape): void {
  const known = registry.get(shape.kind);
  if (known) known.push(shape);
  else {
    registry.set(shape.kind, [shape]);
    kinds.push(basename("/kinds/" + shape.kind));
  }
  sum += shape.area();
}

export function total(): string {
  return sum.toFixed(2);
}

export function area(shape: Shape): number {
  return shape.area();
}

export const describe = (shape: Shape): string => shape.toString();
