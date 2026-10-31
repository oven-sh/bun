console.log("numbers.ts runs");
export const value = 41;
export const other = 7;
export class Shape {
  size: number;
  constructor(size: number) {
    this.size = size;
  }
}
export const Kind = { level: 1 };
export default function double(n: number) {
  return n * 2;
}
