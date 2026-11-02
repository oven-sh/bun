console.log("texts.ts runs");
export const value = "text";
export const other = "other text";
export class Shape {
  name: string;
  constructor(name: string) {
    this.name = name;
  }
}
export function make(text: string) {
  return text + "!";
}
