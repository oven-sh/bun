import missing from "not-installed";
export function one(): number {
  return helper() + 1;
}
function helper(): number {
  return missing ? 0 : 1;
}
export function* steps(): Generator<number> {
  yield one();
}
export async function later(): Promise<number> {
  return one();
}
export class Shape {
  static made = 0;
  #side = 2;
  constructor() {
    Shape.made++;
  }
  area(): number {
    return this.#side * this.#side;
  }
  get side(): number {
    return this.#side;
  }
}
export class Square extends Shape {}
export enum Color {
  Red,
  Green,
}
export namespace space {
  export function inner(): string {
    return "inner";
  }
}
export default function named(): string {
  return "default";
}
export const arrow = () => one();
export { helper as renamedHelper };
console.log("never runs");
