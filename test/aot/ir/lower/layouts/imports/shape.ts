export interface Shape {
  a: number;
}

export function createShape(a: number): Shape {
  return { a };
}
