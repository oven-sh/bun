export class Animal {
  legs: number = 4;
  constructor(public name: string) {}
  speak(): string {
    return this.name + "?";
  }
}
export function count(list: Animal[]): number {
  return list.length;
}
