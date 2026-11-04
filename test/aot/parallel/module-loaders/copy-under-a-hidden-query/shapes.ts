const counts = globalThis as unknown as { loads?: number };
counts.loads = (counts.loads ?? 0) + 1;
export const load: number = counts.loads;

export class Box {
  w: number;
  h: number;
  grow = (by: number): number => this.w + by + load * 100;
  constructor(w: number, h: number) {
    this.w = w;
    this.h = h;
  }
  area(): number {
    return this.w * this.h + load * 1000;
  }
}

export const half = (box: Box): number => box.w / 2 + load * 10;

export function twice(box: Box): number {
  return box.w * 2 + load * 10;
}

export const make = (n: number) => ({
  n,
  get: (): number => n + load * 100,
  me(): number {
    return this.n;
  },
});
